import { describe, expect, it } from 'vitest';
import { assessStorageRequirements, type CollectionMetadataReader } from './storage-shape';
import { DEPOSITCRAFT_STORAGE_REQUIREMENTS } from './storage-collections';

function matchingCollection(id: string) {
  const requirement = DEPOSITCRAFT_STORAGE_REQUIREMENTS.find(r => r.id === id)!;
  return { _id: requirement.id, displayField: requirement.displayField, fields: requirement.fields.map(f => ({ ...f })) };
}

const matchingPermissions = () => ({
  itemRead: 'PRIVILEGED', itemInsert: 'PRIVILEGED', itemUpdate: 'PRIVILEGED', itemRemove: 'PRIVILEGED',
});

const readers = (
  collectionImpl: CollectionMetadataReader,
) => assessStorageRequirements(collectionImpl, 'DepositCraft');

describe('assessStorageRequirements', () => {
  it('reports ready when every collection matches shape and permissions', async () => {
    const result = await readers(async (id: string) => matchingCollection(id));
    expect(result).toMatchObject({ ready: true, state: 'ready' });
  });

  it('accepts dataPermissions when present on collection', async () => {
    const result = await readers(async (id: string) => ({
      ...matchingCollection(id),
      dataPermissions: matchingPermissions(),
    }));
    expect(result).toMatchObject({ ready: true, state: 'ready' });
  });

  it('classifies collection not found (WDE0025) as provisioning', async () => {
    const error = Object.assign(new Error('WDE0025: data collection not found'), {});
    const result = await readers(async () => { throw error; });
    expect(result).toMatchObject({ ready: false, state: 'provisioning' });
    expect(result.details).toContain(DEPOSITCRAFT_STORAGE_REQUIREMENTS[0].id);
  });

  // A 401/403 is distinct from "not yet provisioned": it surfaces as its own
  // `permission_denied` state (with `storageAccessBlockedMessage` copy)
  // instead of being folded into `provisioning`.
  it('classifies permission denied (403) as its own permission_denied state', async () => {
    const error = Object.assign(new Error('403: permission denied for app-private collection'), {});
    const result = await readers(async () => { throw error; });
    expect(result).toMatchObject({ ready: false, state: 'permission_denied' });
    // Unlike the collection-missing branch above, a permission-denied failure
    // is classified per-error (not aggregated across collections), so its
    // `details` carries the underlying error message rather than the
    // collection id list.
    expect(result.details).toContain('permission denied');
  });

  it('classifies wrong field shape as schema_mismatch with update guidance', async () => {
    const result = await readers(async (id: string) => ({ ...matchingCollection(id), displayField: 'payload' }));
    expect(result).toMatchObject({ ready: false, state: 'schema_mismatch' });
    expect(result.message).toContain('update');
  });

  it('classifies non-privileged item permissions as schema_mismatch', async () => {
    const result = await readers(async (id: string) => ({
      ...matchingCollection(id),
      dataPermissions: { itemRead: 'PUBLIC' },
    }));
    expect(result).toMatchObject({ ready: false, state: 'schema_mismatch' });
  });

  it('falls back to the shared classifier for unexpected errors', async () => {
    const result = await readers(async () => { throw new Error('WDE0110: CMS app not installed'); });
    expect(result).toMatchObject({ ready: false, state: 'cms_required' });
  });
});
