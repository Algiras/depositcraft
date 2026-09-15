import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ sendBiEvent: vi.fn() }));
vi.mock('@wix/app-management', () => ({ biEvents: api }));

import { emitDiagnostic, markSetupFinished } from './logger';

beforeEach(() => vi.resetAllMocks());

describe('DepositCraft BI diagnostics', () => {
  it('sends an allowlisted storage failure without merchant or error details', async () => {
    api.sendBiEvent.mockResolvedValue(undefined);

    emitDiagnostic('storage_write', {
      outcome: 'failure',
      durationMs: 17,
      errorCode: 'STORAGE_FAILED',
      wixRequestId: 'wix-request-1',
      customerName: 'Customer Name',
      rawError: 'Bearer secret-token',
    } as never);

    await vi.waitFor(() => expect(api.sendBiEvent).toHaveBeenCalledTimes(1));
    expect(api.sendBiEvent).toHaveBeenCalledWith({
      eventName: 'CUSTOM',
      customEventName: 'depositcraft_storage_write',
      eventData: expect.objectContaining({
        app_version: '1.0.0',
        schema_version: '1',
        outcome: 'failure',
        surface: 'dashboard',
        duration_ms: '17',
        error_code: 'STORAGE_FAILED',
        wix_request_id: 'wix-request-1',
        timestamp: expect.any(String),
      }),
    });
  });

  it('does not reject the caller when Wix BI ingress rejects', async () => {
    api.sendBiEvent.mockRejectedValue(new Error('BI unavailable'));

    expect(() => emitDiagnostic('configuration_load', { outcome: 'failure' })).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('does not throw when BI SDK initialization throws synchronously', () => {
    api.sendBiEvent.mockImplementation(() => { throw new Error('SDK unavailable'); });

    expect(() => emitDiagnostic('configuration_save', { outcome: 'failure' })).not.toThrow();
    expect(() => markSetupFinished()).not.toThrow();
  });

  it('allows the declared order-slot diagnostics', async () => {
    api.sendBiEvent.mockResolvedValue(undefined);

    emitDiagnostic('order_load', { outcome: 'success', surface: 'order_slot' });

    await vi.waitFor(() => expect(api.sendBiEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventData: expect.objectContaining({ surface: 'order_slot' }),
    })));
  });

  it('reports completed onboarding with the Wix-required setup event', async () => {
    api.sendBiEvent.mockResolvedValue(undefined);

    markSetupFinished();

    await vi.waitFor(() => expect(api.sendBiEvent).toHaveBeenCalledWith({ eventName: 'APP_SETUP_FINISHED' }));
  });
});
