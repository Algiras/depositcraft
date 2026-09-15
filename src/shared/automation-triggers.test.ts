import { expect, it } from 'vitest';
import {
  INSTALLMENT_DUE_TRIGGER_KEY,
  installmentAutomationExternalEntityId,
  installmentAutomationIdempotencyKey,
} from './automation-triggers';

it('uses the Dev Center trigger key', () => {
  expect(INSTALLMENT_DUE_TRIGGER_KEY).toBe('installment_due_reminder');
});

it('builds stable idempotency keys per installment', () => {
  expect(installmentAutomationIdempotencyKey('order-1', 2)).toBe('depositcraft:order-1:2:due');
});

it('builds deterministic GUID external entity ids', () => {
  const first = installmentAutomationExternalEntityId('order-1', 0);
  const second = installmentAutomationExternalEntityId('order-1', 1);
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(first).not.toBe(second);
  expect(installmentAutomationExternalEntityId('order-1', 0)).toBe(first);
});
