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

export function toLedgerRecord(ledger: PaymentLedger) {
  return { _id: ledger._id, title: ledger.orderId, payload: ledger };
}

export function fromLedgerRecord(raw: unknown): PaymentLedger | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as PaymentLedger & { payload?: PaymentLedger };
  return record.payload ?? record;
}

export async function getPaymentLedger(orderId: string): Promise<PaymentLedger | undefined> {
  try {
    return fromLedgerRecord(await items.get(PAYMENT_LEDGER_COLLECTION, orderId));
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
