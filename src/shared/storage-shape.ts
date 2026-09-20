import {
  classifyStorageFailure,
  isCollectionMissing,
  isPermissionDenied,
  provisioningMessage,
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
};
export type CollectionMetadataReader = (id: string) => Promise<StorageCollectionShape>;
export type CollectionPermissionsReader = (id: string) => Promise<Record<string, string>>;

function hasRequiredCollectionShape(collection: StorageCollectionShape, requirement: StorageCollectionRequirement) {
  const fields = collection.fields ?? [];
  return collection._id === requirement.id
    && collection.displayField === requirement.displayField
    && requirement.fields.every(field => fields.some(candidate => candidate.key === field.key && candidate.type === field.type));
}

function hasPrivilegedAccess(dataPermissions: Record<string, string> | undefined, requirement: StorageCollectionRequirement) {
  return Object.entries(requirement.dataPermissions).every(([action, role]) => dataPermissions?.[action] === role);
}

export function assessStorageRequirements(
  readCollection: CollectionMetadataReader,
  readPermissions: CollectionPermissionsReader,
  appName: string,
): Promise<StorageReadinessAssessment> {
  return (async () => {
    const missingCollections: string[] = [];
    const invalidCollections: string[] = [];
    for (const requirement of DEPOSITCRAFT_STORAGE_REQUIREMENTS) {
      try {
        const collection = await readCollection(requirement.id);
        const dataPermissions = await readPermissions(requirement.id);
        if (!hasRequiredCollectionShape(collection, requirement) || !hasPrivilegedAccess(dataPermissions, requirement)) {
          invalidCollections.push(requirement.id);
        }
      } catch (error) {
        if (isCollectionMissing(error) || isPermissionDenied(error)) {
          missingCollections.push(requirement.id);
        } else {
          return classifyStorageFailure(error, appName);
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
      } satisfies StorageReadinessAssessment;
    }
    return { ready: true, state: 'ready', message: '' } satisfies StorageReadinessAssessment;
  })();
}
