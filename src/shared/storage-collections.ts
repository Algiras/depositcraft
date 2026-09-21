import { collectionsToRequirements, type StorageCollectionRequirement } from '@wix-extensions/core/storage';
import { DATA_COLLECTIONS_EXTENSION } from '../backend/data-collections/collections';

export const COLLECTION_ID = '@krasalgim/depositcraft/depositcraft-plans';

export type { StorageCollectionRequirement };

export const DEPOSITCRAFT_STORAGE_REQUIREMENTS: readonly StorageCollectionRequirement[] =
  collectionsToRequirements('@krasalgim/depositcraft', DATA_COLLECTIONS_EXTENSION);
