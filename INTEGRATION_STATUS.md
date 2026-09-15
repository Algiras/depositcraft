# Integration status (2026-09-13)

Local verification: unit tests, TypeScript, production build, and dashboard browser harness must pass before release. DepositCraft ships private Wix Data collections, checkout SPIs, order payment request links, and an Automations trigger for installment due reminders.

## Supported today

| Capability | How it works |
| --- | --- |
| Deposit plan configuration | Saved in `depositcraft-plans` via the Data Collections extension. |
| Cart/checkout layaway preview | `ecom-validations` SPI (`deposit-checkout`) discloses deposit schedules before purchase. |
| Checkout deposit collection | Merchant pairs each plan with an automatic discount using the matching `ecom-discounts-trigger` custom trigger. DepositCraft seeds the ledger when the paid total matches the deposit. |
| Post-order payment links | Order Details card and dashboard billing create Wix order payment requests; customers pay manually on the Payment Request Page. |
| Payment sync | `order-payment-request-paid` event and dashboard refresh reconcile paid status and queue the next link. |
| Due-date link creation | Dashboard **Process due installments** and backend billing create links when `dueAt` passes. |
| Email reminders | `installment_due_reminder` Automations trigger — DepositCraft reports scheduled events with buyer `contactId`, `dueAt`, and payment link; merchants configure **Send an email** in Automations. |

## Not supported (do not claim)

- **Silent card charging** — third-party apps cannot call off-session charge APIs; buyers must open each payment request link.
- **Checkout deposit without discount setup** — there is no native checkout “pay deposit only” toggle; merchants must create the paired automatic discount.
- **Collection-scoped plans on orders** — order line items do not expose catalog collection membership; collection rules fail closed.
- **App-owned cron** — use Automations scheduled timing or manual **Process due installments** instead of external schedulers.
- **Inventory reservation / pay-now override** — DepositCraft does not change checkout `payNow` or hold stock.

## Dev Center extensions

Register in Dev Center (see `automation-trigger.draft.json`, `data-collections-extension.draft.json`, `app-tools-extension.draft.json`, and service plugin folders). Playwright helper (CDP Chrome, Workflow 25 Workshop 0):

```bash
python3 scripts/register_depositcraft_automation_trigger.py              # dry-run audit
python3 scripts/register_depositcraft_automation_trigger.py --apply      # Dev Center trigger
python3 scripts/register_depositcraft_automation_trigger.py --apply --site
```

Dev Center URL: `https://manage.wix.com/apps/cecd3584-c6bd-4895-a776-613643ef171d/automations-dev-center`


- Data Collections: `depositcraft-plans`, `depositcraft-payment-ledger`
- App Tools + Tools Provider
- Dashboard page + Order Details secondary card
- SPIs: `ecom-validations/deposit-checkout`, `ecom-discounts-trigger/deposit-triggers`, `tools-provider`
- Backend events: `order-created`, `order-payment-request-paid`
- Automations trigger: `installment_due_reminder` (connect `contactId`, mark `dueAt` as scheduled)

## OAuth note

`Manage Stores` (or equivalent order payment request scope) is required for `createOrderPaymentRequest`. Sync permissions with `python3 scripts/sync_devcenter_permissions.py --apply depositcraft` before release.
