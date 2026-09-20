import { items } from '@wix/data';
import {
  PAYMENT_LEDGER_COLLECTION,
  fromLedgerRecord,
  type PaymentLedger,
} from './payment-ledger';
import { advancePaymentPlanForOrder } from './payment-plan-service';
import type { StartedPaymentPlan } from './payment-ledger';
import { listRecordsPage, type RecordsPage } from './configuration';

export type BillingRunResult = {
  scanned: number;
  linksCreated: number;
  dueCount: number;
  /** True when the ledger drain hit LEDGER_DRAIN_MAX_PAGES/LEDGER_DRAIN_MAX_RECORDS
   * instead of exhausting the collection -- some due ledgers may not have been scanned. */
  capped: boolean;
};

function isDue(installment: PaymentLedger['installments'][number], now: Date): boolean {
  if (installment.status !== 'PENDING' || installment.paymentRequestId) return false;
  if (!installment.dueAt) return false;
  return new Date(installment.dueAt).getTime() <= now.getTime();
}

/**
 * Hard safety caps for draining the payment-ledger collection during a billing scan.
 *
 * The ledger collection is unbounded and never pruned (fully-paid ledgers are kept,
 * merely flagged `archived` -- see `isLedgerFullyPaid`). A merchant who has been live
 * for a while can easily have more than one page of *active* ledgers, so a scan must
 * page through the whole active set rather than reading one arbitrary page -- but it
 * must still be bounded, so a runaway/misbehaving site can never hang or run forever.
 * Mirrors the `MAX_DRAIN_RECORDS`/`MAX_DRAIN_PAGES` pattern in
 * `05-volume-tiered-pricing/discountcraft/src/shared/configuration.ts`.
 */
export const LEDGER_DRAIN_PAGE_SIZE = 100;
export const LEDGER_DRAIN_MAX_PAGES = 20;
export const LEDGER_DRAIN_MAX_RECORDS = 1000;

/** Minimal shape of a Wix Data cursor-based query page this module depends on. */
export interface LedgerCursorPage {
  items: unknown[];
  hasNext?: () => boolean;
  next?: () => Promise<LedgerCursorPage>;
}

export interface LedgerQueryResult {
  ledgers: PaymentLedger[];
  /** True when the drain stopped at the cap instead of exhausting the cursor -- callers
   * MUST surface this (see `installment-scheduler.ts`'s capped diagnostic) so a
   * truncated scan is never silent. */
  capped: boolean;
}

/**
 * Drains a Wix Data CursorBasedIterator page-by-page using only `hasNext()` / `next()`
 * -- never offset, `skip`, or an OffsetBasedIterator's `currentPage`/`totalPages`/
 * `totalCount` -- bounded by a hard cap so a large or runaway collection can never
 * make a billing run hang or run out of memory.
 */
export async function drainLedgerPages(firstPage: LedgerCursorPage): Promise<LedgerQueryResult> {
  const collectedRaw: unknown[] = [...firstPage.items];
  let page = firstPage;
  let pagesFetched = 1;
  let capped = false;

  while (typeof page.hasNext === 'function' && page.hasNext()) {
    if (pagesFetched >= LEDGER_DRAIN_MAX_PAGES || collectedRaw.length >= LEDGER_DRAIN_MAX_RECORDS) {
      capped = true;
      break;
    }
    if (typeof page.next !== 'function') break;
    page = await page.next();
    collectedRaw.push(...page.items);
    pagesFetched += 1;
  }

  if (collectedRaw.length > LEDGER_DRAIN_MAX_RECORDS) {
    capped = true;
    collectedRaw.length = LEDGER_DRAIN_MAX_RECORDS;
  }

  const ledgers = collectedRaw
    .map(raw => fromLedgerRecord(raw))
    .filter((ledger): ledger is PaymentLedger => Boolean(ledger));

  return { ledgers, capped };
}

type QueryLedgers = () => Promise<LedgerQueryResult>;

/**
 * Dashboard-safe (unelevated) ledger query for a billing scan: filters out ledgers
 * whose installments are all PAID server-side (`archived`) so the active working set
 * stays small, and pages through the rest with `drainLedgerPages` instead of reading
 * a single arbitrary 100-record page (the original bug: any ledger outside that
 * slice was never scanned again once the collection grew past one page).
 */
async function defaultQueryLedgers(): Promise<LedgerQueryResult> {
  const firstPage = await items.query(PAYMENT_LEDGER_COLLECTION)
    .ne('archived', true)
    .limit(LEDGER_DRAIN_PAGE_SIZE)
    .find();
  return drainLedgerPages(firstPage as unknown as LedgerCursorPage);
}

/** Cursor-paged read over the (unbounded, one-record-per-payment) payment ledger, for the dashboard UI. */
export async function listPaymentLedgerPage(opts: { cursor?: string; pageSize?: number } = {}): Promise<RecordsPage<PaymentLedger>> {
  const page = await listRecordsPage<unknown>(PAYMENT_LEDGER_COLLECTION, opts);
  const ledgers = page.items
    .map(raw => fromLedgerRecord(raw))
    .filter((ledger): ledger is PaymentLedger => Boolean(ledger));
  return { items: ledgers, nextCursor: page.nextCursor, hasNext: page.hasNext };
}

type AdvancePlan = (orderId: string) => Promise<StartedPaymentPlan | undefined>;

/**
 * Creates payment links for installments whose due date has passed. Customers still pay
 * manually. `queryLedgers`/`advance` default to the plain, unelevated dashboard behavior
 * (merchant session). The backend billing scheduler (no merchant session) passes an
 * elevated `queryLedgers` and an `advance` bound to an `auth.elevate`d `PaymentDataAccess`.
 */
export async function processDueInstallments(
  queryLedgers: QueryLedgers = defaultQueryLedgers,
  advance: AdvancePlan = advancePaymentPlanForOrder,
): Promise<BillingRunResult> {
  const now = new Date();
  const { ledgers, capped } = await queryLedgers();
  let linksCreated = 0;
  let dueCount = 0;
  for (const ledger of ledgers) {
    const dueInstallments = ledger.installments.filter(item => isDue(item, now));
    if (!dueInstallments.length) continue;
    dueCount += dueInstallments.length;
    const hasOpenRequest = ledger.installments.some(item => item.paymentRequestUrl && item.status !== 'PAID');
    if (hasOpenRequest) continue;
    const result = await advance(ledger.orderId);
    if (result) linksCreated += 1;
  }
  return { scanned: ledgers.length, linksCreated, dueCount, capped };
}
