import { items } from '@wix/data';
import {
  PAYMENT_LEDGER_COLLECTION,
  fromLedgerRecord,
  type PaymentLedger,
} from './payment-ledger';
import { advancePaymentPlanForOrder } from './payment-plan-service';
import { listRecordsPage, type RecordsPage } from './configuration';

export type BillingRunResult = {
  scanned: number;
  linksCreated: number;
  dueCount: number;
};

function isDue(installment: PaymentLedger['installments'][number], now: Date): boolean {
  if (installment.status !== 'PENDING' || installment.paymentRequestId) return false;
  if (!installment.dueAt) return false;
  return new Date(installment.dueAt).getTime() <= now.getTime();
}

type QueryLedgers = () => Promise<PaymentLedger[]>;

async function defaultQueryLedgers(): Promise<PaymentLedger[]> {
  const result = await items.query(PAYMENT_LEDGER_COLLECTION).limit(100).find();
  return result.items
    .map(raw => fromLedgerRecord(raw))
    .filter((ledger): ledger is PaymentLedger => Boolean(ledger));
}

/** Cursor-paged read over the (unbounded, one-record-per-payment) payment ledger, for the dashboard UI. */
export async function listPaymentLedgerPage(opts: { cursor?: string; pageSize?: number } = {}): Promise<RecordsPage<PaymentLedger>> {
  const page = await listRecordsPage<unknown>(PAYMENT_LEDGER_COLLECTION, opts);
  const ledgers = page.items
    .map(raw => fromLedgerRecord(raw))
    .filter((ledger): ledger is PaymentLedger => Boolean(ledger));
  return { items: ledgers, nextCursor: page.nextCursor, hasNext: page.hasNext };
}

/** Creates payment links for installments whose due date has passed. Customers still pay manually. */
export async function processDueInstallments(queryLedgers: QueryLedgers = defaultQueryLedgers): Promise<BillingRunResult> {
  const now = new Date();
  const ledgers = await queryLedgers();
  let linksCreated = 0;
  let dueCount = 0;
  for (const ledger of ledgers) {
    const dueInstallments = ledger.installments.filter(item => isDue(item, now));
    if (!dueInstallments.length) continue;
    dueCount += dueInstallments.length;
    const hasOpenRequest = ledger.installments.some(item => item.paymentRequestUrl && item.status !== 'PAID');
    if (hasOpenRequest) continue;
    const result = await advancePaymentPlanForOrder(ledger.orderId);
    if (result) linksCreated += 1;
  }
  return { scanned: ledgers.length, linksCreated, dueCount };
}
