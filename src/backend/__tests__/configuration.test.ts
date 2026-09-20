import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ entries: undefined as unknown, fail: false, probeError: undefined as Error | undefined }));

vi.mock('@wix/data', () => ({
  items: {
    query: vi.fn(() => ({
      eq: () => ({
        find: async () => {
          if (db.fail) throw new Error('denied');
          return {
            items: db.entries === undefined ? [] : [{ payload: { entries: structuredClone(db.entries) } }],
          };
        },
      }),
      // Storage-readiness probe path: query(id).limit(1).find(...) (see createItemsQueryReader).
      limit: () => ({
        find: async () => {
          if (db.probeError) throw db.probeError;
          return { items: [] };
        },
      }),
    })),
    save: async (_collection: string, item: { payload: { entries: unknown } }) => {
      if (db.fail) throw new Error('denied');
      db.entries = structuredClone(item.payload.entries);
    },
  },
  collections: {
    getDataCollection: vi.fn(),
  },
}));

import { assessConfigurationStorage, loadConfiguration, saveConfiguration, initializeConfiguration, COLLECTION_ID } from '../../shared/configuration';
import { collections } from '@wix/data';

beforeEach(() => {
  db.entries = undefined;
  db.fail = false;
  db.probeError = undefined;
  vi.mocked(collections.getDataCollection).mockClear();
});

it('keeps new installations empty, round-trips create/edit/delete without restoring defaults', async () => {
  expect(await loadConfiguration()).toEqual([]);
  await saveConfiguration([{ id: 'one', enabled: true }, { id: 'two', enabled: true }]);
  expect(await loadConfiguration()).toHaveLength(2);
  await saveConfiguration([{ id: 'one', enabled: false }]);
  expect(await loadConfiguration()).toEqual([{ id: 'one', enabled: false }]);
  await saveConfiguration([]);
  expect(await loadConfiguration()).toEqual([]);
});

it('surfaces storage failures instead of reporting a successful save or loading sample data', async () => {
  db.fail = true;
  await expect(saveConfiguration([])).rejects.toThrow('denied');
  await expect(loadConfiguration()).rejects.toThrow('denied');
});

it('reports provisioning when the collection is missing', async () => {
  db.probeError = new Error('WDE0025 data collection not found');
  const readiness = await assessConfigurationStorage();
  expect(readiness.ready).toBe(false);
  expect(readiness.state).toBe('provisioning');
  await expect(initializeConfiguration()).rejects.toThrow('DepositCraft is still provisioning private storage');
  expect(collections.getDataCollection).not.toHaveBeenCalled();
});

// assessConfigurationStorage is a single, unretried probe (it is the callback
// `confirmStorageWithAutoRetry` invokes repeatedly from the dashboard, and
// the same probe `runInstallStorageVerification` retries in the backend
// install-verify loop). classifyStorageFailure's raw per-probe semantics for
// a 403 are unchanged here: whether a 403 is provisional (retried behind the
// Loader) or terminal (shown to the merchant) is decided by those retry
// layers, not by this single-probe assessment -- see
// packages/core/src/storage/storage.test.ts and
// src/shared/storage-readiness.test.ts for the retry-budget contract.
it('reports a distinct permission_denied state when private storage returns 403', async () => {
  db.probeError = new Error('403 Forbidden');
  const readiness = await assessConfigurationStorage();
  expect(readiness.ready).toBe(false);
  expect(readiness.state).toBe('permission_denied');
  expect(readiness.message).toContain('Complete Setup');
});

it('verifies the collection is queryable when properly provisioned', async () => {
  const { items } = await import('@wix/data');
  await initializeConfiguration();
  expect(items.query).toHaveBeenCalledWith(COLLECTION_ID);
});

// Backend/SPI callers with no merchant session (e.g. the tools-provider SPI)
// must pass an elevated `getCollection`/`query`; the dashboard omits it and
// gets today's unelevated default. These prove the parameter is actually
// threaded through, not just accepted and ignored.
it('reads configuration through a caller-supplied query fn instead of the module default', async () => {
  db.entries = [{ id: 'one', enabled: true }];
  const { items } = await import('@wix/data');
  vi.mocked(items.query).mockClear();
  const elevatedQuery = vi.fn(() => ({
    eq: () => ({ find: async () => ({ items: [{ payload: { entries: db.entries } }] }) }),
  }));
  const result = await loadConfiguration(elevatedQuery as never);
  expect(result).toEqual([{ id: 'one', enabled: true }]);
  expect(elevatedQuery).toHaveBeenCalledWith(COLLECTION_ID);
  expect(items.query).not.toHaveBeenCalled();
});

it('assesses storage through a caller-supplied reader instead of the module default', async () => {
  const elevatedReader = vi.fn(async (id: string) => ({ _id: id, shapeUnknown: true }));
  const readiness = await assessConfigurationStorage(elevatedReader as never);
  expect(readiness.ready).toBe(true);
  expect(elevatedReader).toHaveBeenCalled();
  expect(collections.getDataCollection).not.toHaveBeenCalled();
});

it('reports ready-but-unverified since an items.query probe can never see collection structure', async () => {
  // Deliberate, permanent trade-off of the fix: the old getDataCollection-based
  // probe could reject an incompatible schema (e.g. missing fields); an
  // items.query-based probe cannot see collection structure at all, so that
  // detection is no longer possible via the default reader. A caller that
  // legitimately holds DATA-COLLECTIONS-MANAGE can still opt into a
  // getDataCollection-based reader (see the test above) for full verification.
  const readiness = await assessConfigurationStorage();
  expect(readiness.ready).toBe(true);
  expect(readiness.state).toBe('ready');
  expect(readiness.items?.every(item => item.permissionsVerified === false)).toBe(true);
  expect(collections.getDataCollection).not.toHaveBeenCalled();
});
