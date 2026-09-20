import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { orderPaymentRequests } from '@wix/ecom';
import { processDueInstallments } from '../shared/installment-billing';
import { advancePaymentPlanForOrder, type PaymentDataAccess } from '../shared/payment-plan-service';
import { PAYMENT_LEDGER_COLLECTION, fromLedgerRecord, type PaymentLedger } from '../shared/payment-ledger';
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

/** Backend entry point for scheduled billing (call from events or jobs). */
export async function runInstallmentBilling() {
  const start = Date.now();
  try {
    const elevatedQuery = auth.elevate(items.query);
    const result = await processDueInstallments(
      async () => {
        const response = await elevatedQuery(PAYMENT_LEDGER_COLLECTION).limit(100).find();
        return response.items
          .map(raw => fromLedgerRecord(raw))
          .filter((ledger): ledger is PaymentLedger => Boolean(ledger));
      },
      orderId => advancePaymentPlanForOrder(orderId, elevatedAccess),
    );
    emitDiagnostic('installment_billing_run', { outcome: 'success', surface: 'backend', durationMs: Date.now() - start });
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
