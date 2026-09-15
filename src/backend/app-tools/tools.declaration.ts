// Generated from src/backend/extensions/manifest.json — do not edit.
// extensions.appTools declaration for DepositCraft
export const APP_TOOLS = {
  id: 'bdb3fec6-175b-49ca-b49f-e473a2130d21',
  name: 'depositcraft-tools',
  tools: [
      {
        "methodName": "get-entitlement",
        "description": "Returns the current DepositCraft plan entitlement for this site instance, including whether Pro features are active.",
        "requestSchema": {
          "type": "object",
          "properties": {}
        },
        "responseSchema": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string"
            },
            "isPaid": {
              "type": "boolean"
            }
          }
        },
        "activated": true
      },
      {
        "methodName": "verify-storage",
        "description": "Checks whether DepositCraft private Wix Data storage is provisioned on this site.",
        "requestSchema": {
          "type": "object",
          "properties": {}
        },
        "responseSchema": {
          "type": "object",
          "properties": {
            "ready": {
              "type": "boolean"
            }
          }
        },
        "activated": true
      },
      {
        "methodName": "describe-config",
        "description": "Summarizes how many DepositCraft configuration records exist in private storage.",
        "requestSchema": {
          "type": "object",
          "properties": {}
        },
        "responseSchema": {
          "type": "object",
          "properties": {
            "count": {
              "type": "number"
            }
          }
        },
        "activated": true
      }
    ],
} as const;
