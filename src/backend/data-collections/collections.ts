/** Generated from src/backend/extensions/manifest.json — do not edit. */
export const DATA_COLLECTIONS_EXTENSION = {
  "componentName": "DepositCraft private plans and ledger",
  "collections": [
    {
      "idSuffix": "depositcraft-plans",
      "displayName": "DepositCraftPlans",
      "displayField": "title",
      "fields": [
        {
          "key": "title",
          "displayName": "Title",
          "type": "TEXT"
        },
        {
          "key": "payload",
          "displayName": "Payload",
          "type": "OBJECT",
          "objectOptions": {
            "fields": []
          }
        }
      ],
      "dataPermissions": {
        "itemRead": "PRIVILEGED",
        "itemInsert": "PRIVILEGED",
        "itemUpdate": "PRIVILEGED",
        "itemRemove": "PRIVILEGED"
      },
      "indexes": [],
      "initialData": []
    },
    {
      "idSuffix": "depositcraft-payment-ledger",
      "displayName": "DepositCraftPaymentLedger",
      "displayField": "title",
      "fields": [
        {
          "key": "title",
          "displayName": "Title",
          "type": "TEXT"
        },
        {
          "key": "payload",
          "displayName": "Payload",
          "type": "OBJECT",
          "objectOptions": {
            "fields": []
          }
        }
      ],
      "dataPermissions": {
        "itemRead": "PRIVILEGED",
        "itemInsert": "PRIVILEGED",
        "itemUpdate": "PRIVILEGED",
        "itemRemove": "PRIVILEGED"
      },
      "indexes": [],
      "initialData": []
    }
  ]
} as const;
