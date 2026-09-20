import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportEvent: vi.fn(async () => ({ activationIds: ['activation-1'] })),
  cancelEvent: vi.fn(async () => {}),
  getOrder: vi.fn(async () => ({
    buyerInfo: { contactId: 'fc81a355-3429-50fc-a4c7-def486e828f3' },
  })),
}));

vi.mock('@wix/automations', () => ({
  activations: { reportEvent: mocks.reportEvent, cancelEvent: mocks.cancelEvent },
}));
// Spy (not a plain passthrough) so tests can prove *whether* auth.elevate was
// invoked for a given call -- dashboard readers must never elevate, backend
// readers must always.
const essentials = vi.hoisted(() => ({ elevate: vi.fn((fn: unknown) => fn) }));
vi.mock('@wix/essentials', () => ({ auth: { elevate: essentials.elevate } }));
vi.mock('@wix/ecom', () => ({ orders: { getOrder: mocks.getOrder } }));

import { syncInstallmentAutomations } from '../automation-reporter';
import { emitDiagnostic } from '../../shared/logger';
import type { PaymentLedger } from '../../shared/payment-ledger';

vi.mock('../../shared/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/logger')>();
  return { ...actual, emitDiagnostic: vi.fn() };
});

const ledger: PaymentLedger = {
  _id: 'order-1',
  orderId: 'order-1',
  ruleId: 'plan-1',
  currency: 'USD',
  totalOrderAmount: 100,
  installments: [
    {
      installmentNumber: 0,
      amount: 25,
      status: 'PAID',
      dueAt: '2026-09-01T12:00:00.000Z',
      paymentRequestId: 'request-0',
      paymentRequestUrl: 'https://pay.test/0',
    },
    {
      installmentNumber: 1,
      amount: 75,
      status: 'PENDING',
      dueAt: '2026-10-01T12:00:00.000Z',
      paymentRequestUrl: 'https://pay.test/1',
    },
  ],
};

beforeEach(() => {
  mocks.reportEvent.mockClear();
  mocks.cancelEvent.mockClear();
  mocks.getOrder.mockClear();
  essentials.elevate.mockClear();
  vi.mocked(emitDiagnostic).mockClear();
});

it('cancels paid installments and reports pending due installments', async () => {
  await syncInstallmentAutomations(ledger);
  expect(mocks.cancelEvent).toHaveBeenCalledTimes(1);
  expect(mocks.reportEvent).toHaveBeenCalledTimes(1);
  const firstCall = mocks.reportEvent.mock.calls[0] as unknown as [string, { payload?: Record<string, unknown> }];
  expect(firstCall?.[0]).toBe('installment_due_reminder');
  expect(firstCall?.[1]?.payload).toMatchObject({
    contactId: 'fc81a355-3429-50fc-a4c7-def486e828f3',
    orderId: 'order-1',
    installmentNumber: 1,
    amount: 75,
    currency: 'USD',
    dueAt: '2026-10-01T12:00:00.000Z',
    paymentRequestUrl: 'https://pay.test/1',
  });
});

it('skips reporting when the order has no buyer contact', async () => {
  mocks.getOrder.mockResolvedValueOnce({ buyerInfo: {} } as Awaited<ReturnType<typeof mocks.getOrder>>);
  await syncInstallmentAutomations(ledger);
  expect(mocks.reportEvent).not.toHaveBeenCalled();
});

it('does NOT elevate orders.getOrder/activations.reportEvent/cancelEvent by default (dashboard/merchant-session path)', async () => {
  await syncInstallmentAutomations(ledger);
  // Note: this module's own BI diagnostics (`emitDiagnostic` = the elevated
  // `emitBackendDiagnostic`) are out of scope for this fix -- only the three
  // Wix API calls (orders.getOrder, activations.reportEvent, cancelEvent)
  // are asserted here.
  expect(essentials.elevate).not.toHaveBeenCalledWith(mocks.getOrder);
  expect(essentials.elevate).not.toHaveBeenCalledWith(mocks.reportEvent);
  expect(essentials.elevate).not.toHaveBeenCalledWith(mocks.cancelEvent);
  expect(mocks.cancelEvent).toHaveBeenCalledTimes(1);
  expect(mocks.reportEvent).toHaveBeenCalledTimes(1);
});

it('elevates orders.getOrder/activations.reportEvent/cancelEvent when explicitly run in a backend/no-session context', async () => {
  await syncInstallmentAutomations(ledger, { elevated: true });
  expect(essentials.elevate).toHaveBeenCalledWith(mocks.getOrder);
  expect(essentials.elevate).toHaveBeenCalledWith(mocks.reportEvent);
  expect(essentials.elevate).toHaveBeenCalledWith(mocks.cancelEvent);
  expect(mocks.cancelEvent).toHaveBeenCalledTimes(1);
  expect(mocks.reportEvent).toHaveBeenCalledTimes(1);
});

it('defaults the diagnostics emitter to the PLAIN (non-elevated) one, matching the dashboard-reached call sites', async () => {
  const backendEmit = vi.fn();
  await syncInstallmentAutomations(ledger, {}, backendEmit);
  expect(backendEmit).toHaveBeenCalledWith('automation_cancel', expect.objectContaining({ outcome: 'success' }));
  expect(backendEmit).toHaveBeenCalledWith('automation_report', expect.objectContaining({ outcome: 'success' }));
  expect(emitDiagnostic).not.toHaveBeenCalled();

  vi.clearAllMocks();
  await syncInstallmentAutomations(ledger);
  expect(emitDiagnostic).toHaveBeenCalledWith('automation_cancel', expect.objectContaining({ outcome: 'success' }));
  expect(emitDiagnostic).toHaveBeenCalledWith('automation_report', expect.objectContaining({ outcome: 'success' }));
});
