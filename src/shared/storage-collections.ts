import { PAYMENT_LEDGER_COLLECTION } from './payment-ledger';

export const COLLECTION_ID = '@krasalgim/depositcraft/depositcraft-plans';

export type StorageCollectionRequirement = {
  id: string;
  displayField: string;
  fields: ReadonlyArray<{ key: string; type: string }>;
  dataPermissions: Record<string, string>;
};

export const DEPOSITCRAFT_STORAGE_REQUIREMENTS: readonly StorageCollectionRequirement[] = [
  {
    id: COLLECTION_ID,
    displayField: 'title',
    fields: [
      { key: 'title', type: 'TEXT' },
      { key: 'payload', type: 'OBJECT' },
    ],
    dataPermissions: {
      itemRead: 'PRIVILEGED',
      itemInsert: 'PRIVILEGED',
      itemUpdate: 'PRIVILEGED',
      itemRemove: 'PRIVILEGED',
    },
  },
  {
    id: PAYMENT_LEDGER_COLLECTION,
    displayField: 'title',
    fields: [
      { key: 'title', type: 'TEXT' },
      { key: 'payload', type: 'OBJECT' },
    ],
    dataPermissions: {
      itemRead: 'PRIVILEGED',
      itemInsert: 'PRIVILEGED',
      itemUpdate: 'PRIVILEGED',
      itemRemove: 'PRIVILEGED',
    },
  },
];
