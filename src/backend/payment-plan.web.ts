import { webMethod, Permissions } from '@wix/web-methods';
import {
  advancePaymentPlanForOrder as advancePaymentPlanForOrderImpl,
  startPaymentPlanForOrder as startPaymentPlanForOrderImpl,
  syncPaymentPlanFromWix as syncPaymentPlanFromWixImpl,
} from '../shared/payment-plan-service';

/**
 * Web-method boundary for the merchant-triggered payment-plan operations
 * that `src/dashboard/plugins/order-details/plugin.tsx` drives
 * (`startPaymentPlanForOrder`, `advancePaymentPlanForOrder`,
 * `syncPaymentPlanFromWix`, called there as `handleStartPaymentPlan`,
 * `handleAdvancePlan` and `handleRefreshStatus`).
 *
 * BOUNDARY CHOICE: this wraps the three whole merchant-triggered operations
 * from `src/shared/payment-plan-service.ts`, not the low-level
 * `syncInstallmentAutomations`/`reportInstallmentDueAutomation` reporter in
 * `src/backend/automation-reporter.ts`. Each dashboard action ("create a
 * payment request", "create the next payment link", "refresh payment
 * status") is one coherent unit of work spanning order lookup, ledger
 * read/write and automation reporting; a web method per Wix SDK call would
 * fragment that unit across several network round-trips for no benefit, and
 * would still leave the low-level reporter reachable straight from the
 * dashboard bundle. One web method per operation matches the actual
 * merchant action and keeps the round-trip count the same as before this fix
 * (one call from the dashboard per button click).
 *
 * All three run with `Permissions.Admin`: creating/advancing a payment plan
 * and reading Wix payment-request status for an order are merchant/admin
 * actions on the Orders page, not something an arbitrary site visitor should
 * be able to trigger.
 *
 * The exported names match `src/shared/payment-plan-service.ts` exactly so
 * the dashboard call site (`plugin.tsx`) only needs its import path changed,
 * not its call sites. `advancePaymentPlanForOrder` keeps its optional
 * `access`/`automationOptions`/`automationEmit` parameters in its type, but
 * this web method is only ever invoked from the dashboard with just an
 * `orderId` -- exactly how `plugin.tsx` already calls it -- so it keeps the
 * plain (unelevated) defaults for this session-driven, Admin-permissioned
 * path.
 *
 * Genuine backend callers (`src/backend/payment-request-lifecycle.ts`,
 * `checkout-order-lifecycle.ts`, `installment-scheduler.ts`) do NOT go
 * through this file: `installment-scheduler.ts` keeps importing
 * `advancePaymentPlanForOrder` directly from `../shared/payment-plan-service`
 * with an explicitly `auth.elevate`d `PaymentDataAccess` and
 * `{ elevated: true }`, and `payment-request-lifecycle.ts`/
 * `checkout-order-lifecycle.ts` call their own already-elevated equivalents
 * (`startExistingOrderPaymentPlan`, `createNextRequest`,
 * `handleOrderPaymentRequestPaid`) -- none of that is routed through a web
 * method, since those callers have no merchant session to forward and no
 * Admin-permission check to apply.
 *
 * ON THE "ELEVATED" PLUMBING: now that the dashboard reaches these
 * operations only through this web method (a real server-side RPC, not code
 * bundled into the browser), nothing here would crash if it called
 * `auth.elevate` directly. But `AutomationReportOptions` (in
 * `automation-reporter.ts`) and `PaymentDataAccess` (in
 * `payment-plan-service.ts`) are NOT dead: `installment-scheduler.ts` still
 * depends on both to run `advancePaymentPlanForOrder` fully elevated with no
 * merchant session at all (a scheduled/webhook-driven run, unrelated to this
 * web method). Removing either would break that genuine backend caller, so
 * neither was removed here -- this file only removes the *reason* the
 * dashboard path had to stay unelevated (an `auth.elevate` call could no
 * longer crash it); it leaves the backend path's needs untouched.
 */
export const startPaymentPlanForOrder = webMethod(Permissions.Admin, startPaymentPlanForOrderImpl);
export const advancePaymentPlanForOrder = webMethod(Permissions.Admin, advancePaymentPlanForOrderImpl);
export const syncPaymentPlanFromWix = webMethod(Permissions.Admin, syncPaymentPlanFromWixImpl);
