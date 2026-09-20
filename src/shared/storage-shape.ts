import {
  classifyStorageFailure,
  isCollectionMissing,
  isPermissionDenied,
  provisioningMessage,
  type StorageCheckItem,
  type StorageReadinessAssessment,
} from './storage-readiness';
import { DEPOSITCRAFT_STORAGE_REQUIREMENTS, type StorageCollectionRequirement } from './storage-collections';

/**
 * Pure storage assessment over injected accessors so the dashboard (merchant
 * session) and the backend (auth.elevate) share ONE classification
 * implementation. Keep free of SDK imports.
 */
export type StorageCollectionShape = {
  _id?: string;
  displayField?: string | null;
  fields?: Array<{ key?: string; type?: string }>;
  permissions?: unknown;
  dataPermissions?: unknown;
};
export type CollectionMetadataReader = (id: string) => Promise<StorageCollectionShape>;
export type CollectionPermissions = unknown;
export type CollectionPermissionsReader = (id: string) => Promise<CollectionPermissions>;

function hasRequiredCollectionShape(collection: StorageCollectionShape, requirement: StorageCollectionRequirement) {
  const fields = collection.fields ?? [];
  return collection._id === requirement.id
    && collection.displayField === requirement.displayField
    && requirement.fields.every(field => fields.some(candidate => candidate.key === field.key && candidate.type === field.type));
}

function hasPrivilegedAccess(dataPermissions: Record<string, string> | undefined, requirement: StorageCollectionRequirement) {
  if (!dataPermissions || Object.keys(dataPermissions).length === 0) return true;
  return Object.entries(requirement.dataPermissions).every(([action, role]) => dataPermissions?.[action] === role);
}

function findMissingPermissions(dataPermissions: Record<string, string> | undefined, requirement: StorageCollectionRequirement): string[] {
  if (!dataPermissions || Object.keys(dataPermissions).length === 0) return [];
  const missing: string[] = [];
  for (const [action, role] of Object.entries(requirement.dataPermissions)) {
    if (dataPermissions[action] !== role) {
      missing.push(`${action}: expected ${role}, found ${dataPermissions[action] ?? 'none'}`);
    }
  }
  return missing;
}

function unwrapDataPermissions(response: unknown): Record<string, string> | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const wrapped = (response as { dataPermissions?: unknown }).dataPermissions;
  if (wrapped && typeof wrapped === 'object') return wrapped as Record<string, string>;
  return response as Record<string, string>;
}

export function assessStorageRequirements(
  readCollection: CollectionMetadataReader,
  readPermissions: CollectionPermissionsReader,
  appName: string,
): Promise<StorageReadinessAssessment> {
  return (async () => {
    const missingCollections: string[] = [];
    const invalidCollections: string[] = [];
    const checkItems: StorageCheckItem[] = [];

    for (const requirement of DEPOSITCRAFT_STORAGE_REQUIREMENTS) {
      const collectionName = requirement.id.split('/').pop() || requirement.id;
      try {
        const collection = await readCollection(requirement.id);
        let dataPermissions = unwrapDataPermissions(collection.dataPermissions ?? collection.permissions);
        if (!dataPermissions && readPermissions) {
          try {
            dataPermissions = unwrapDataPermissions(await readPermissions(requirement.id));
          } catch {
            // DataPermissionsService requires WIX_DATA.PERMISSIONS_READ. When denied,
            // the successful readCollection confirms the collection exists.
            dataPermissions = undefined;
          }
        }
        const shapeValid = hasRequiredCollectionShape(collection, requirement);
        const missingPerms = findMissingPermissions(dataPermissions, requirement);
        const privileged = missingPerms.length === 0 && hasPrivilegedAccess(dataPermissions, requirement);

        if (!shapeValid || !privileged) {
          invalidCollections.push(requirement.id);
          checkItems.push({
            id: requirement.id,
            name: collectionName,
            ready: false,
            status: 'schema_mismatch',
            detail: !shapeValid ? 'Collection fields or displayField mismatch' : 'Collection permission mismatch',
            missingPermissions: missingPerms.length > 0 ? missingPerms : undefined,
          });
        } else {
          checkItems.push({
            id: requirement.id,
            name: collectionName,
            ready: true,
            status: 'ready',
            detail: 'Active and verified',
          });
        }
      } catch (error) {
        if (isCollectionMissing(error) || isPermissionDenied(error)) {
          missingCollections.push(requirement.id);
          checkItems.push({
            id: requirement.id,
            name: collectionName,
            ready: false,
            status: 'missing',
            detail: 'Awaiting provisioning by Wix',
          });
        } else {
          const failure = classifyStorageFailure(error, appName);
          checkItems.push({
            id: requirement.id,
            name: collectionName,
            ready: false,
            status: 'error',
            detail: failure.message,
          });
          return {
            ...failure,
            items: checkItems,
          };
        }
      }
    }
    if (missingCollections.length > 0 || invalidCollections.length > 0) {
      const details = [...missingCollections, ...invalidCollections].join(', ');
      return {
        ready: false,
        state: invalidCollections.length > 0 ? 'schema_mismatch' : 'provisioning',
        message: invalidCollections.length > 0
          ? `${appName} storage on this site does not match the latest app version. Open Manage Apps, update ${appName} to the latest version, then click Retry.`
          : provisioningMessage(appName),
        details,
        items: checkItems,
      } satisfies StorageReadinessAssessment;
    }
    return { ready: true, state: 'ready', message: '', items: checkItems } satisfies StorageReadinessAssessment;
  })();
}
