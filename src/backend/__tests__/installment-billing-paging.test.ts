import { beforeEach, expect, it, vi } from 'vitest';
import type { PaymentLedger } from '../../shared/payment-ledger';

const db = vi.hoisted(() => ({ records: [] as Array<{ _id: string; payload: unknown }> }));

function makePage(consumed: number, pageSize: number) {
  const pageItems = db.records.slice(consumed, consumed + pageSize);
  return {
    items: pageItems,
    hasNext: () => consumed + pageItems.length < db.records.length,
    next: async () => makePage(consumed + pageItems.length, pageSize),
  };
}

vi.mock('@wix/data', () => ({
  items: {
    query: vi.fn(() => {
      let limit = 50;
      const builder = {
        limit: (n: number) => {
          limit = n;
          return builder;
        },
        find: async () => makePage(0, limit),
      };
      return builder;
    }),
  },
  collections: { getDataCollection: vi.fn() },
  permissions: { getPermissions: vi.fn() },
}));

import { listPaymentLedgerPage, processDueInstallments } from '../../shared/installment-billing';

function ledger(orderId: string): PaymentLedger {
  return {
    _id: orderId,
    orderId,
    ruleId: 'rule-1',
    currency: 'USD',
    totalOrderAmount: 100,
    installments: [{ installmentNumber: 1, amount: 25, status: 'PENDING' }],
  };
}

beforeEach(() => {
  db.records = Array.from({ length: 7 }, (_, i) => ({ _id: `order-${i}`, payload: ledger(`order-${i}`) }));
});

it('pages payment ledger records and resumes from the returned cursor', async () => {
  const first = await listPaymentLedgerPage({ pageSize: 3 });
  expect(first.items.map(l => l.orderId)).toEqual(['order-0', 'order-1', 'order-2']);
  expect(first.hasNext).toBe(true);

  const second = await listPaymentLedgerPage({ cursor: first.nextCursor, pageSize: 3 });
  expect(second.items.map(l => l.orderId)).toEqual(['order-3', 'order-4', 'order-5']);
  expect(second.hasNext).toBe(true);

  const third = await listPaymentLedgerPage({ cursor: second.nextCursor, pageSize: 3 });
  expect(third.items.map(l => l.orderId)).toEqual(['order-6']);
  expect(third.hasNext).toBe(false);
  expect(third.nextCursor).toBeUndefined();
});

it('drops null raw records instead of surfacing them as blank rows', async () => {
  db.records = [null as unknown as { _id: string; payload: unknown }, { _id: 'order-0', payload: ledger('order-0') }];
  const page = await listPaymentLedgerPage({ pageSize: 10 });
  expect(page.items).toHaveLength(1);
  expect(page.items[0].orderId).toBe('order-0');
});

// The backend billing scheduler passes its own `queryLedgers` (elevated) and
// `advance` (bound to an elevated `PaymentDataAccess`) instead of the
// module's defaults; the dashboard's "Process due installments" button omits
// both and gets today's unelevated behavior. This proves the `advance`
// parameter is actually invoked per due ledger rather than ignored.
it('threads a caller-supplied advance function (e.g. an elevated backend one) per due ledger', async () => {
  const due = ledger('order-9');
  due.installments = [{ installmentNumber: 1, amount: 25, status: 'PENDING', dueAt: new Date(Date.now() - 1000).toISOString() }];
  const advance = vi.fn(async () => undefined);
  const result = await processDueInstallments(async () => [due], advance);
  expect(advance).toHaveBeenCalledWith('order-9');
  expect(result).toEqual({ scanned: 1, linksCreated: 0, dueCount: 1 });
});
