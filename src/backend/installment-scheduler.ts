import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { processDueInstallments } from '../shared/installment-billing';
import { PAYMENT_LEDGER_COLLECTION, fromLedgerRecord, type PaymentLedger } from '../shared/payment-ledger';
import { emitDiagnostic } from '../shared/logger';

/** Backend entry point for scheduled billing (call from events or jobs). */
export async function runInstallmentBilling() {
  const start = Date.now();
  try {
    const elevatedQuery = auth.elevate(items.query);
    const result = await processDueInstallments(async () => {
      const response = await elevatedQuery(PAYMENT_LEDGER_COLLECTION).limit(100).find();
      return response.items
        .map(raw => fromLedgerRecord(raw))
        .filter((ledger): ledger is PaymentLedger => Boolean(ledger));
    });
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
