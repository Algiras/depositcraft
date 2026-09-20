import { expect, it, vi } from 'vitest';

const handleOrderPaymentRequestPaid = vi.hoisted(() => vi.fn(async () => {}));
const runInstallmentBilling = vi.hoisted(() => vi.fn(async () => ({ scanned: 0, linksCreated: 0, dueCount: 0, capped: false })));
const onOrderPaymentRequestPaid = vi.hoisted(() => vi.fn());

vi.mock('@wix/ecom', () => ({
  orderPaymentRequests: { onOrderPaymentRequestPaid },
}));

vi.mock('../payment-request-lifecycle', () => ({ handleOrderPaymentRequestPaid }));

// The webhook file no longer imports this at all; mocking it anyway lets the test
// fail loudly (rather than silently passing) if a future change reintroduces the
// import and call.
vi.mock('../installment-scheduler', () => ({ runInstallmentBilling }));

import '../events/order-payment-request-paid/event';

// Regression test for Bug 2: this webhook used to call `runInstallmentBilling()` --
// a full unbounded scan of every due ledger -- on every delivery, fanning one
// shopper's payment into serial billing work for every OTHER currently-due order
// inside the webhook's short wall-clock budget. `handleOrderPaymentRequestPaid`
// already advances only the order that was actually paid, so the handler must not
// also trigger a broad scan.
it('advances only the order that was paid and does not trigger a full due-installment scan', async () => {
  expect(onOrderPaymentRequestPaid).toHaveBeenCalledTimes(1);
  const handler = onOrderPaymentRequestPaid.mock.calls[0][0] as (event: unknown) => Promise<void>;

  await handler({ data: { orderPaymentRequest: { _id: 'request-1', orderId: 'order-1' } } });

  expect(handleOrderPaymentRequestPaid).toHaveBeenCalledWith('request-1', 'order-1');
  expect(handleOrderPaymentRequestPaid).toHaveBeenCalledTimes(1);
  expect(runInstallmentBilling).not.toHaveBeenCalled();
});
