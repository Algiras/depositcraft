import { describe, expect, it } from 'vitest';
import { assessStorageRequirements, type CollectionMetadataReader, type CollectionPermissionsReader } from './storage-shape';
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
  permissionsImpl: CollectionPermissionsReader = async () => matchingPermissions(),
) => assessStorageRequirements(collectionImpl, permissionsImpl, 'DepositCraft');

describe('assessStorageRequirements', () => {
  it('reports ready when every collection matches shape and permissions', async () => {
    const result = await readers(async id => matchingCollection(id));
    expect(result).toMatchObject({ ready: true, state: 'ready' });
  });

  it.each([
    ['collection not found (WDE0025)', Object.assign(new Error('WDE0025: data collection not found'), {})],
    ['permission denied (403)', Object.assign(new Error('403: permission denied for app-private collection'), {})],
  ])('classifies %s as provisioning', async (_label, error) => {
    const result = await readers(async () => { throw error; });
    expect(result).toMatchObject({ ready: false, state: 'provisioning' });
    expect(result.details).toContain(DEPOSITCRAFT_STORAGE_REQUIREMENTS[0].id);
  });

  it('classifies wrong field shape as schema_mismatch with update guidance', async () => {
    const result = await readers(async id => ({ ...matchingCollection(id), displayField: 'payload' }));
    expect(result).toMatchObject({ ready: false, state: 'schema_mismatch' });
    expect(result.message).toContain('update');
  });

  it('classifies non-privileged item permissions as schema_mismatch', async () => {
    const result = await readers(async id => matchingCollection(id), async () => ({ itemRead: 'PUBLIC' }));
    expect(result).toMatchObject({ ready: false, state: 'schema_mismatch' });
  });

  it('falls back to the shared classifier for unexpected errors', async () => {
    const result = await readers(async () => { throw new Error('WDE0110: CMS app not installed'); });
    expect(result).toMatchObject({ ready: false, state: 'cms_required' });
  });
});
