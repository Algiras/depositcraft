import { beforeEach, expect, it, vi } from 'vitest';

const emitDiagnostic = vi.hoisted(() => vi.fn());

vi.mock('@wix/essentials', () => ({ auth: { elevate: (fn: unknown) => fn } }));

vi.mock('@wix/data', () => ({
  items: {
    query: vi.fn(() => {
      const builder = {
        ne: () => builder,
        limit: () => builder,
        find: async () => ({ items: [], hasNext: () => false }),
      };
      return builder;
    }),
    get: vi.fn(),
    save: vi.fn(),
  },
}));

vi.mock('@wix/ecom', () => ({
  orderPaymentRequests: {
    queryOrderPaymentRequests: vi.fn(() => ({ eq: () => ({ find: async () => ({ items: [] }) }) })),
    createOrderPaymentRequest: vi.fn(),
    getOrderPaymentRequestUrl: vi.fn(),
  },
}));

vi.mock('../../shared/logger', () => ({
  emitBackendDiagnostic: (...args: unknown[]) => emitDiagnostic(...args),
}));

// Only `drainLedgerPages` is stubbed (to force the capped branch without having to
// wire up 1000+ fake ledger records) -- `processDueInstallments` stays the real
// implementation, so this still proves `runInstallmentBilling` reacts to a real
// `capped: true` result from the shared billing module, not to a hand-rolled shape.
vi.mock('../../shared/installment-billing', async importOriginal => {
  const actual = await importOriginal<typeof import('../../shared/installment-billing')>();
  return {
    ...actual,
    drainLedgerPages: vi.fn(async () => ({ ledgers: [], capped: true })),
  };
});

import { runInstallmentBilling } from '../installment-scheduler';

beforeEach(() => {
  emitDiagnostic.mockClear();
});

// Regression test for the original bug: a truncated ledger drain used to be
// indistinguishable from a fully successful run -- the scheduler just returned
// `{ scanned, linksCreated, dueCount }` either way. Silent truncation must be
// impossible: hitting the drain cap must surface as a failure-outcome diagnostic
// through the app's existing backend telemetry helper, using the existing
// `installment_billing_run` event name (no new BI event introduced).
it('emits a failure-outcome installment_billing_run diagnostic when the ledger drain is capped, instead of reporting a plain success', async () => {
  const result = await runInstallmentBilling();
  expect(result.capped).toBe(true);
  expect(emitDiagnostic).toHaveBeenCalledTimes(1);
  expect(emitDiagnostic).toHaveBeenCalledWith('installment_billing_run', expect.objectContaining({
    outcome: 'failure',
    surface: 'backend',
    errorCode: 'LEDGER_DRAIN_CAPPED',
  }));
});
