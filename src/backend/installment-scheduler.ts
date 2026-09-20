import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { orderPaymentRequests } from '@wix/ecom';
import {
  drainLedgerPages,
  processDueInstallments,
  LEDGER_DRAIN_PAGE_SIZE,
  type LedgerCursorPage,
} from '../shared/installment-billing';
import { advancePaymentPlanForOrder, type PaymentDataAccess } from '../shared/payment-plan-service';
import { PAYMENT_LEDGER_COLLECTION } from '../shared/payment-ledger';
import { emitBackendDiagnostic as emitDiagnostic } from '../shared/logger';

/**
 * This runs from a Wix event handler (`order-payment-request-paid`) with no
 * merchant session, so every Wix Data/ecom call it drives -- directly and via
 * `processDueInstallments` -> `advancePaymentPlanForOrder` -- must go through
 * `auth.elevate` or it fails with 403 Forbidden / "Missing authentication information".
 */
const elevatedAccess: PaymentDataAccess = {
  getItem: auth.elevate(items.get),
  saveItem: auth.elevate(items.save),
  queryRequests: auth.elevate(orderPaymentRequests.queryOrderPaymentRequests),
  createRequest: auth.elevate(orderPaymentRequests.createOrderPaymentRequest),
  getRequestUrl: auth.elevate(orderPaymentRequests.getOrderPaymentRequestUrl),
};

/**
 * Full due-installment scan for a genuine backend/scheduled trigger (no merchant
 * session -- every read/write is elevated). Not called from the
 * `order-payment-request-paid` webhook: that handler already knows which single
 * order was paid and advances only that order's plan directly (see
 * `events/order-payment-request-paid/event.ts`), so it must not fan out into a
 * full scan of every other due ledger inside its short webhook budget. This
 * function remains available for a merchant-triggered full run or a future
 * scheduled job.
 */
export async function runInstallmentBilling() {
  const start = Date.now();
  try {
    const elevatedQuery = auth.elevate(items.query);
    const result = await processDueInstallments(
      async () => {
        const firstPage = await elevatedQuery(PAYMENT_LEDGER_COLLECTION)
          .ne('archived', true)
          .limit(LEDGER_DRAIN_PAGE_SIZE)
          .find();
        return drainLedgerPages(firstPage as unknown as LedgerCursorPage);
      },
      orderId => advancePaymentPlanForOrder(orderId, elevatedAccess),
    );
    if (result.capped) {
      // Silent truncation must be impossible: a capped drain means some due ledgers
      // were not scanned this run. Surface it as a failure-outcome diagnostic
      // (rather than silently reporting the truncated run as a plain success) so
      // it is visible to whoever monitors `installment_billing_run`.
      emitDiagnostic('installment_billing_run', {
        outcome: 'failure',
        surface: 'backend',
        durationMs: Date.now() - start,
        errorCode: 'LEDGER_DRAIN_CAPPED',
      });
    } else {
      emitDiagnostic('installment_billing_run', { outcome: 'success', surface: 'backend', durationMs: Date.now() - start });
    }
    return result;
  } catch (error) {
    emitDiagnostic('installment_billing_run', {
      outcome: 'failure',
      surface: 'backend',
      durationMs: Date.now() - start,
      errorCode: 'INSTALLMENT_BILLING_FAILED',
    });
    throw error;
  }
}
