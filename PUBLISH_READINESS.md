# DepositCraft linked-site publish readiness

**Local identity:** app `cecd3584-c6bd-4895-a776-613643ef171d`; linked site `4f9c31b9-ddcf-4ae7-bd8e-d09d38e7694f`.

## What ships today

- Deposit plan configuration and schedule preview (dashboard page).
- Cart/checkout layaway disclosure (`ecom-validations` SPI).
- Checkout deposit collection when merchants pair each plan with an automatic discount using the matching `ecom-discounts-trigger` custom trigger.
- Order payment request links from Order Details; ledger sync on paid webhooks and dashboard refresh.
- Due-date link creation via **Process due installments** or backend billing.
- Installment due Automations trigger (`installment_due_reminder`) — merchants configure **Send an email** in Automations.

## What we do not support

- Off-session / silent card charging (buyers must open each payment request link).
- Checkout deposits without merchant discount setup.
- Collection-scoped plans on orders.
- App-owned external cron or background servers.

## Acceptance runbook

1. Confirm app/site identity; release with Data Collections, SPIs, events, and Automations trigger registered in Dev Center.
2. Verify `DepositCraftPlans` and `DepositCraftPaymentLedger` provision on install; dashboard setup succeeds.
3. Save a plan, pair an automatic discount with its DepositCraft trigger, place a checkout order paying only the deposit, and confirm ledger seed + next installment link.
4. Start a plan on an existing order from Order Details; confirm payment link, paid sync, and next link creation.
5. Activate an **Installment due reminder** automation (email to contact, timed to `dueAt`); confirm a reported event after link creation.
6. Confirm listing copy and in-app helpers match supported / not-supported limits above.

Retain Wix request IDs for any platform failure; local tests alone are not release evidence.
