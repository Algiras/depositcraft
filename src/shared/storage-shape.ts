import {
  assessStorageRequirements as coreAssessStorageRequirements,
  type CollectionMetadataReader,
  type StorageCollectionRequirement,
  type StorageCollectionShape,
  type StorageReadinessAssessment,
} from '@wix-extensions/core/storage';
import { DEPOSITCRAFT_STORAGE_REQUIREMENTS } from './storage-collections';

export type {
  CollectionMetadataReader,
  StorageCollectionRequirement,
  StorageCollectionShape,
  StorageReadinessAssessment,
};

export async function assessStorageRequirements(
  readCollection: CollectionMetadataReader,
  appName: string,
  requirements: readonly StorageCollectionRequirement[] = DEPOSITCRAFT_STORAGE_REQUIREMENTS,
): Promise<StorageReadinessAssessment> {
  return coreAssessStorageRequirements(readCollection, appName, requirements);
}
