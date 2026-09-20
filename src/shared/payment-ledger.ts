import { items } from '@wix/data';

export const PAYMENT_LEDGER_COLLECTION = '@krasalgim/depositcraft/depositcraft-payment-ledger';

export type InstallmentStatus = 'PENDING' | 'CREATING' | 'PAID';

export interface LedgerInstallment {
  installmentNumber: number;
  amount: number;
  paymentRequestId?: string;
  paymentRequestUrl?: string;
  status: InstallmentStatus;
  /** ISO timestamp when this installment becomes due (post-checkout billing). */
  dueAt?: string;
}

export interface PaymentLedger {
  _id: string;
  orderId: string;
  ruleId: string;
  currency: string;
  totalOrderAmount: number;
  installments: LedgerInstallment[];
}

export interface StartedPaymentPlan {
  orderId: string;
  paymentRequestId: string;
  paymentRequestUrl: string;
  installmentNumber: number;
  amount: number;
  currency: string;
}

export function money(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}

/**
 * `archived` is a top-level (non-`payload`) field so the billing scan can filter it
 * server-side (`.ne('archived', true)`) without a nested-field query on `payload`.
 * It is recomputed from the installments on every save -- never set by hand -- so a
 * ledger automatically drops out of (or back into) the active billing scan as its
 * installments change. This keeps the payment-ledger collection's *working set*
 * bounded for billing without ever deleting a merchant's payment records.
 */
export function isLedgerFullyPaid(ledger: PaymentLedger): boolean {
  return ledger.installments.length > 0 && ledger.installments.every(item => item.status === 'PAID');
}

export function toLedgerRecord(ledger: PaymentLedger) {
  return { _id: ledger._id, title: ledger.orderId, archived: isLedgerFullyPaid(ledger), payload: ledger };
}

export function fromLedgerRecord(raw: unknown): PaymentLedger | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as PaymentLedger & { payload?: PaymentLedger };
  return record.payload ?? record;
}

/**
 * `getItem` defaults to the plain (unelevated) `items.get` for dashboard
 * callers, which have a merchant session. Backend callers with no merchant
 * session must pass `auth.elevate(items.get)` or the read fails with 403.
 */
export async function getPaymentLedger(
  orderId: string,
  getItem: typeof items.get = items.get,
): Promise<PaymentLedger | undefined> {
  try {
    return fromLedgerRecord(await getItem(PAYMENT_LEDGER_COLLECTION, orderId));
  } catch {
    return undefined;
  }
}

export function paymentRequestExternalId(orderId: string, installmentNumber: number): string {
  return `depositcraft:${orderId}:${installmentNumber}`;
}

export function startedPlan(ledger: PaymentLedger): StartedPaymentPlan {
  const installment = ledger.installments.find(item => item.paymentRequestId && item.paymentRequestUrl);
  if (!installment?.paymentRequestId || !installment.paymentRequestUrl) {
    throw new Error('No Wix payment request is ready for this plan.');
  }
  return {
    orderId: ledger.orderId,
    paymentRequestId: installment.paymentRequestId,
    paymentRequestUrl: installment.paymentRequestUrl,
    installmentNumber: installment.installmentNumber,
    amount: installment.amount,
    currency: ledger.currency,
  };
}
