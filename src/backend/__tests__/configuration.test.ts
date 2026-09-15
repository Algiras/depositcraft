import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ entries: undefined as unknown, fail: false }));

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
    })),
    save: async (_collection: string, item: { payload: { entries: unknown } }) => {
      if (db.fail) throw new Error('denied');
      db.entries = structuredClone(item.payload.entries);
    },
  },
  collections: {
    getDataCollection: vi.fn(async (id: string) => ({
      _id: id,
      displayField: 'title',
      fields: [{ key: 'title', type: 'TEXT' }, { key: 'payload', type: 'OBJECT' }],
    })),
  },
  permissions: {
    getPermissions: vi.fn(async () => ({
      itemRead: 'PRIVILEGED',
      itemInsert: 'PRIVILEGED',
      itemUpdate: 'PRIVILEGED',
      itemRemove: 'PRIVILEGED',
    })),
  },
}));

import { assessConfigurationStorage, loadConfiguration, saveConfiguration, initializeConfiguration, COLLECTION_ID } from '../../shared/configuration';
import { collections, permissions } from '@wix/data';

beforeEach(() => {
  db.entries = undefined;
  db.fail = false;
  vi.mocked(collections.getDataCollection).mockImplementation((async (id: string) => ({
    _id: id,
    displayField: 'title',
    fields: [{ key: 'title', type: 'TEXT' }, { key: 'payload', type: 'OBJECT' }],
  })) as never);
  vi.mocked(permissions.getPermissions).mockResolvedValue({
    itemRead: 'PRIVILEGED',
    itemInsert: 'PRIVILEGED',
    itemUpdate: 'PRIVILEGED',
    itemRemove: 'PRIVILEGED',
  } as never);
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
  vi.mocked(collections.getDataCollection).mockRejectedValue(new Error('WDE0025 data collection not found'));
  const readiness = await assessConfigurationStorage();
  expect(readiness.ready).toBe(false);
  expect(readiness.state).toBe('provisioning');
  await expect(initializeConfiguration()).rejects.toThrow('DepositCraft is still provisioning private storage');
});

it('reports provisioning when private storage returns 403 before collections exist', async () => {
  vi.mocked(collections.getDataCollection).mockRejectedValue(new Error('403 Forbidden'));
  const readiness = await assessConfigurationStorage();
  expect(readiness.ready).toBe(false);
  expect(readiness.state).toBe('provisioning');
  expect(readiness.message).toContain('still provisioning private storage');
  expect(readiness.message).not.toContain('Complete Setup');
});

it('verifies the collection is queryable when properly provisioned', async () => {
  const { items } = await import('@wix/data');
  await initializeConfiguration();
  expect(items.query).toHaveBeenCalledWith(COLLECTION_ID);
});

it('rejects an existing collection with incompatible schema', async () => {
  vi.mocked(collections.getDataCollection).mockResolvedValueOnce({
    _id: COLLECTION_ID,
    displayField: 'title',
    fields: [],
  } as never);
  vi.mocked(permissions.getPermissions).mockResolvedValueOnce({
    itemRead: 'ANYONE',
    itemInsert: 'PRIVILEGED',
    itemUpdate: 'PRIVILEGED',
    itemRemove: 'PRIVILEGED',
  } as never);
  const readiness = await assessConfigurationStorage();
  expect(readiness.ready).toBe(false);
  expect(readiness.state).toBe('schema_mismatch');
});
