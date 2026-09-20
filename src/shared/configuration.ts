import { collections, items, permissions } from '@wix/data';
import { emitDiagnostic, markSetupFinished } from './logger';
import {
  classifyStorageFailure,
  extractRequestId,
  type StorageReadinessAssessment,
  withStorageTimeout,
} from './storage-readiness';
import { assessStorageRequirements } from './storage-shape';
import { COLLECTION_ID } from './storage-collections';

export { COLLECTION_ID };
const APP_NAME = 'DepositCraft';

export async function assessConfigurationStorage(): Promise<StorageReadinessAssessment> {
  const start = Date.now();
  try {
    const assessment = await withStorageTimeout(() =>
      assessStorageRequirements(
        (id) => collections.getDataCollection(id, { consistentRead: true }),
        (id) => permissions.getPermissions(id) as Promise<Record<string, string>>,
        APP_NAME,
      ));
    if (!assessment.ready) {
      emitDiagnostic('storage_metadata_read', {
        outcome: 'failure',
        durationMs: Date.now() - start,
        errorCode: assessment.state.toUpperCase(),
        wixRequestId: assessment.requestId,
      });
    } else {
      emitDiagnostic('storage_metadata_read', { outcome: 'success', durationMs: Date.now() - start });
    }
    return assessment;
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
        message: provisioningTimeoutMessage(),
        details: 'Storage check timed out after 15 seconds.',
      };
    }
    return classifyStorageFailure(error, APP_NAME);
  }
}

function provisioningTimeoutMessage(): string {
  return `${APP_NAME} is still provisioning private storage after install or update. This usually finishes within 10–15 minutes — click Check again or keep this page open.`;
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
