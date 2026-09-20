import { beforeEach, expect, it, vi } from 'vitest';
import { Permissions } from '@wix/web-methods';

const service = vi.hoisted(() => ({
  startPaymentPlanForOrder: vi.fn(async (orderId: string) => ({ orderId, paymentRequestUrl: 'https://pay.example/1' })),
  advancePaymentPlanForOrder: vi.fn(async (orderId: string) => ({ orderId, paymentRequestUrl: 'https://pay.example/2' })),
  syncPaymentPlanFromWix: vi.fn(async (orderId: string) => ({ orderId, installments: [] })),
}));
vi.mock('../../shared/payment-plan-service', () => service);

import {
  advancePaymentPlanForOrder,
  startPaymentPlanForOrder,
  syncPaymentPlanFromWix,
} from '../payment-plan.web';

beforeEach(() => {
  service.startPaymentPlanForOrder.mockClear();
  service.advancePaymentPlanForOrder.mockClear();
  service.syncPaymentPlanFromWix.mockClear();
});

/**
 * These are the only three operations `src/dashboard/plugins/order-details/plugin.tsx`
 * drives (`handleStartPaymentPlan`, `handleAdvancePlan`, `handleRefreshStatus`).
 * They must be reachable only as `Permissions.Admin` web methods -- not as a plain
 * import of `src/shared/payment-plan-service.ts` straight into the dashboard bundle --
 * and must forward to the exact same underlying implementation the backend
 * (`installment-scheduler.ts`) uses, unmodified.
 */
it('exposes startPaymentPlanForOrder as an Admin-only web method forwarding to the shared implementation', async () => {
  expect((startPaymentPlanForOrder as unknown as { permission: string }).permission).toBe(Permissions.Admin);
  await expect(startPaymentPlanForOrder('order-1', 'plan-25')).resolves.toEqual({ orderId: 'order-1', paymentRequestUrl: 'https://pay.example/1' });
  expect(service.startPaymentPlanForOrder).toHaveBeenCalledWith('order-1', 'plan-25');
});

it('exposes advancePaymentPlanForOrder as an Admin-only web method forwarding to the shared implementation', async () => {
  expect((advancePaymentPlanForOrder as unknown as { permission: string }).permission).toBe(Permissions.Admin);
  await expect(advancePaymentPlanForOrder('order-1')).resolves.toEqual({ orderId: 'order-1', paymentRequestUrl: 'https://pay.example/2' });
  expect(service.advancePaymentPlanForOrder).toHaveBeenCalledWith('order-1');
});

it('exposes syncPaymentPlanFromWix as an Admin-only web method forwarding to the shared implementation', async () => {
  expect((syncPaymentPlanFromWix as unknown as { permission: string }).permission).toBe(Permissions.Admin);
  await expect(syncPaymentPlanFromWix('order-1')).resolves.toEqual({ orderId: 'order-1', installments: [] });
  expect(service.syncPaymentPlanFromWix).toHaveBeenCalledWith('order-1');
});
