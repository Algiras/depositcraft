import { orderPaymentRequests } from '@wix/ecom';
import { handleOrderPaymentRequestPaid } from '../../payment-request-lifecycle';

/**
 * Advances only the order that was just paid. `handleOrderPaymentRequestPaid`
 * already marks the matching installment PAID and creates the next installment's
 * payment link for THAT order -- the webhook already knows exactly which order to
 * work on, so there is nothing left for a broader scan to do here.
 *
 * This used to also call `runInstallmentBilling()`, a full unbounded scan of every
 * due ledger, on every single delivery of this webhook: one shopper's payment fanned
 * out into serial billing work (each ~5 sequential Wix calls) for every OTHER
 * currently-due order, inside a webhook's short wall-clock budget. Same class of
 * failure as the 2026-09-20 hotfix noted in `events/app-installed/event.ts` (a
 * retrying loop there caused install timeouts/500s). The full scan is still
 * available via the dashboard's "Process due installments" button
 * (`shared/installment-billing.ts`) and `installment-scheduler.ts`'s
 * `runInstallmentBilling` for a genuine scheduled trigger -- just not from here.
 */
orderPaymentRequests.onOrderPaymentRequestPaid(async event => {
  const request = event.data.orderPaymentRequest;
  await handleOrderPaymentRequestPaid(request?._id ?? '', request?.orderId);
});
