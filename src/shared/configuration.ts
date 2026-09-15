import { collections, items, permissions } from '@wix/data';
import { emitDiagnostic, markSetupFinished } from './logger';
import {
  classifyStorageFailure,
  extractRequestId,
  isCollectionMissing,
  isPermissionDenied,
  provisioningMessage,
  type StorageReadinessAssessment,
  withStorageTimeout,
} from './storage-readiness';
import { COLLECTION_ID, DEPOSITCRAFT_STORAGE_REQUIREMENTS, type StorageCollectionRequirement } from './storage-collections';

export { COLLECTION_ID };
const APP_NAME = 'DepositCraft';

function hasRequiredCollectionShape(collection: { _id?: string; displayField?: string | null; fields?: Array<{ key?: string; type?: string }> }, requirement: StorageCollectionRequirement) {
  const fields = collection.fields ?? [];
  return collection._id === requirement.id
    && collection.displayField === requirement.displayField
    && requirement.fields.every(field => fields.some(candidate => candidate.key === field.key && candidate.type === field.type));
}

function hasPrivilegedAccess(dataPermissions: Record<string, string> | undefined, requirement: StorageCollectionRequirement) {
  return Object.entries(requirement.dataPermissions).every(([action, role]) => dataPermissions?.[action] === role);
}

export async function assessConfigurationStorage(): Promise<StorageReadinessAssessment> {
  const start = Date.now();
  try {
    return await withStorageTimeout(async () => {
      const missingCollections: string[] = [];
      const invalidCollections: string[] = [];
      for (const requirement of DEPOSITCRAFT_STORAGE_REQUIREMENTS) {
        try {
          const collection = await collections.getDataCollection(requirement.id, { consistentRead: true });
          const dataPermissions = await permissions.getPermissions(requirement.id) as Record<string, string>;
          if (!hasRequiredCollectionShape(collection, requirement) || !hasPrivilegedAccess(dataPermissions, requirement)) {
            invalidCollections.push(requirement.id);
          }
        } catch (error) {
          if (isCollectionMissing(error) || isPermissionDenied(error)) {
            missingCollections.push(requirement.id);
          } else {
            const classified = classifyStorageFailure(error, APP_NAME);
            emitDiagnostic('storage_metadata_read', {
              outcome: 'failure',
              durationMs: Date.now() - start,
              errorCode: classified.state.toUpperCase(),
              wixRequestId: classified.requestId,
            });
            return classified;
          }
        }
      }
      if (missingCollections.length > 0 || invalidCollections.length > 0) {
        const details = [...missingCollections, ...invalidCollections].join(', ');
        emitDiagnostic('storage_metadata_read', {
          outcome: 'failure',
          durationMs: Date.now() - start,
          errorCode: invalidCollections.length > 0 ? 'SCHEMA_MISMATCH' : 'PROVISIONING',
        });
        return {
          ready: false,
          state: invalidCollections.length > 0 ? 'schema_mismatch' : 'provisioning',
          message: invalidCollections.length > 0
            ? `${APP_NAME} storage on this site does not match the latest app version. Open Manage Apps, update ${APP_NAME} to the latest version, then click Retry.`
            : provisioningMessage(APP_NAME),
          details,
        };
      }
      emitDiagnostic('storage_metadata_read', { outcome: 'success', durationMs: Date.now() - start });
      return { ready: true, state: 'ready', message: '' };
    });
  } catch (error) {
    const classified = classifyStorageFailure(error, APP_NAME);
    emitDiagnostic('storage_metadata_read', {
      outcome: 'failure',
      durationMs: Date.now() - start,
      errorCode: classified.state.toUpperCase(),
      wixRequestId: classified.requestId ?? extractRequestId(error),
    });
    if (error instanceof Error && error.message === 'STORAGE_CHECK_TIMEOUT') {
      return {
        ready: false,
        state: 'timeout',
        message: provisioningMessage(APP_NAME),
        details: 'Storage check timed out after 15 seconds.',
      };
    }
    return classifyStorageFailure(error, APP_NAME);
  }
}

export async function verifyConfigurationStorage(): Promise<boolean> {
  return (await assessConfigurationStorage()).ready;
}

export async function loadConfiguration<T>(): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await items.query(COLLECTION_ID).eq('_id', 'configuration').find({ consistentRead: true });
    const entries = (result.items[0]?.payload?.entries as T[] | undefined) ?? [];
    emitDiagnostic('configuration_load', { outcome: 'success', durationMs: Date.now() - start });
    return entries;
  } catch (error) {
    emitDiagnostic('configuration_load', {
      outcome: 'failure',
      durationMs: Date.now() - start,
      errorCode: 'STORAGE_READ_FAILED',
      wixRequestId: extractRequestId(error),
    });
    throw error;
  }
}

export async function saveConfiguration<T>(entries: T[]): Promise<void> {
  const start = Date.now();
  try {
    await items.save(COLLECTION_ID, { _id: 'configuration', title: 'Configuration', payload: { entries } });
    emitDiagnostic('configuration_save', { outcome: 'success', durationMs: Date.now() - start });
  } catch (error) {
    emitDiagnostic('configuration_save', {
      outcome: 'failure',
      durationMs: Date.now() - start,
      errorCode: 'STORAGE_WRITE_FAILED',
      wixRequestId: extractRequestId(error),
    });
    throw error;
  }
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface RecordsPage<T> {
  items: T[];
  /** Opaque resume token for the next page. Undefined once there is nothing more to load. */
  nextCursor?: string;
  hasNext: boolean;
}

async function fetchRecordsPage(collectionId: string, pageSize: number) {
  return items.query(collectionId).limit(pageSize).find();
}

type QueryPageHandle = Awaited<ReturnType<typeof fetchRecordsPage>>;

/**
 * The installed @wix/data query result (`WixDataResult`) only exposes `hasNext()` /
 * `next()` on the page it just returned -- there is no standalone cursor token on the
 * wire to hand back to a future, unrelated call. To resume a follow-up page without
 * re-draining the collection from the start, we keep the previous page's own result
 * object in memory here, keyed by an opaque token we mint and return as `nextCursor`.
 * This is safe for the dashboard's lifetime (one browser tab, one module instance); if
 * a token is ever unrecognized (e.g. after a reload) we simply restart from page one
 * rather than throwing.
 */
const pageHandles = new Map<string, QueryPageHandle>();
let cursorSequence = 0;

function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize) || pageSize <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE);
}

/**
 * Cursor-based page read for an unbounded collection. Never falls back to offset/skip
 * or total-count paging -- callers get one bounded page plus a token for the next one.
 */
export async function listRecordsPage<T>(collectionId: string, opts: { cursor?: string; pageSize?: number } = {}): Promise<RecordsPage<T>> {
  const pageSize = clampPageSize(opts.pageSize);
  const handle = opts.cursor ? pageHandles.get(opts.cursor) : undefined;
  if (opts.cursor) pageHandles.delete(opts.cursor);
  const result = handle ? await handle.next() : await fetchRecordsPage(collectionId, pageSize);
  const hasNext = result.hasNext();
  let nextCursor: string | undefined;
  if (hasNext) {
    cursorSequence += 1;
    nextCursor = `page-${Date.now()}-${cursorSequence}`;
    pageHandles.set(nextCursor, result);
  }
  return { items: result.items as T[], nextCursor, hasNext };
}

export async function initializeConfiguration(): Promise<void> {
  const start = Date.now();
  try {
    const readiness = await assessConfigurationStorage();
    if (!readiness.ready) {
      throw new Error(readiness.message);
    }
    await items.query(COLLECTION_ID).eq('_id', 'configuration').find({ consistentRead: true });
    emitDiagnostic('storage_init', { outcome: 'success', durationMs: Date.now() - start });
    markSetupFinished();
  } catch (error) {
    const classified = classifyStorageFailure(error, APP_NAME);
    emitDiagnostic('storage_init', {
      outcome: 'failure',
      durationMs: Date.now() - start,
      errorCode: classified.state.toUpperCase(),
      wixRequestId: classified.requestId ?? extractRequestId(error),
    });
    throw error;
  }
}
