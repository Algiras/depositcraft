import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@wix/data', () => ({ items: { query: vi.fn() } }));
vi.mock('@wix/essentials', () => ({ auth: { elevate: (fn: unknown) => fn } }));
vi.mock('@wix/ecom/service-plugins', () => ({
  customTriggers: { provideHandlers: (handlers: unknown) => handlers },
}));

const emitDiagnosticSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/logger')>();
  return { ...actual, emitBackendDiagnostic: emitDiagnosticSpy };
});

const cartEvaluation = vi.hoisted(() => ({
  evaluateCartDepositPlans: vi.fn(),
  eligibleDepositTriggers: vi.fn((): { customTriggerId: string; identifier: string }[] => []),
}));
vi.mock('../../../../shared/cart-evaluation', () => cartEvaluation);

const rulesStore = vi.hoisted(() => ({ listDepositRules: vi.fn() }));
vi.mock('../../../../shared/rules-store', () => rulesStore);

vi.mock('../../../../shared/entitlement', () => ({ getAppEntitlement: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../../shared/plan-limits', () => ({ restrictRulesForEntitlement: (rules: unknown[]) => rules }));

import { handleEligibleTriggers, handleListTriggers } from './plugin';

describe('deposit-triggers discounts-trigger SPI failure policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rulesStore.listDepositRules.mockResolvedValue([{ id: 'deposit-1', name: 'Deposit Plan', enabled: true }]);
    cartEvaluation.eligibleDepositTriggers.mockReturnValue([]);
  });

  it('lists enabled deposit rules as triggers', async () => {
    const response = await handleListTriggers(undefined as any);
    expect(response.customTriggers).toHaveLength(1);
  });

  it('fails open (no triggers) rather than throwing when listTriggers blows up, and emits a failure diagnostic', async () => {
    rulesStore.listDepositRules.mockRejectedValue(new Error('storage outage'));

    await expect(handleListTriggers(undefined as any)).resolves.toEqual({ customTriggers: [] });

    expect(emitDiagnosticSpy).toHaveBeenCalledWith('deposit_evaluate', expect.objectContaining({
      outcome: 'failure',
      surface: 'spi',
      errorCode: 'DEPOSIT_TRIGGER_LIST_SPI_FAILED',
    }));
  });

  it('returns eligible triggers computed from the cart evaluation', async () => {
    cartEvaluation.evaluateCartDepositPlans.mockResolvedValue({ evaluation: {}, enabled: [] });
    cartEvaluation.eligibleDepositTriggers.mockReturnValue([{ customTriggerId: 'x', identifier: 'y' }]);
    const response = await handleEligibleTriggers({ request: {}, metadata: {} } as any);
    expect(response).toEqual({ eligibleTriggers: [{ customTriggerId: 'x', identifier: 'y' }] });
  });

  it('forwards the request-scoped triggers to eligibleDepositTriggers so the response echoes the caller identifier, not our rule id', async () => {
    // Shape lifted from the docs' sample `getEligibleTriggers` request.
    const requestedTriggers = [
      { customTrigger: { _id: 'depositcraft-deposit-1' }, identifier: '123' },
      { customTrigger: { _id: 'my-happy-hour-trigger' }, identifier: '234' },
    ];
    const evaluation = { eligible: true, ruleId: 'deposit-1', remainingBalance: 75 };
    cartEvaluation.evaluateCartDepositPlans.mockResolvedValue({ evaluation, enabled: [{ id: 'deposit-1' }] });
    cartEvaluation.eligibleDepositTriggers.mockReturnValue([{ customTriggerId: 'depositcraft-deposit-1', identifier: '123' }]);

    const response = await handleEligibleTriggers({ request: { triggers: requestedTriggers }, metadata: {} } as any);

    expect(cartEvaluation.eligibleDepositTriggers).toHaveBeenCalledWith(
      [{ id: 'deposit-1' }],
      evaluation,
      requestedTriggers,
    );
    // The requested identifier ('123'), not our internal rule id ('deposit-1'), must come back.
    expect(response).toEqual({ eligibleTriggers: [{ customTriggerId: 'depositcraft-deposit-1', identifier: '123' }] });
  });

  it('handles a request with no triggers to filter by (undefined `request.triggers`)', async () => {
    cartEvaluation.evaluateCartDepositPlans.mockResolvedValue({ evaluation: {}, enabled: [] });
    cartEvaluation.eligibleDepositTriggers.mockReturnValue([]);

    const response = await handleEligibleTriggers({ request: {}, metadata: {} } as any);

    expect(cartEvaluation.eligibleDepositTriggers).toHaveBeenCalledWith([], {}, undefined);
    expect(response).toEqual({ eligibleTriggers: [] });
  });

  it('fails open (no eligible triggers) rather than propagating an error to the shopper, and emits a failure diagnostic', async () => {
    cartEvaluation.evaluateCartDepositPlans.mockRejectedValue(new Error('elevation/auth failure'));

    await expect(handleEligibleTriggers({ request: {}, metadata: {} } as any)).resolves.toEqual({ eligibleTriggers: [] });

    expect(emitDiagnosticSpy).toHaveBeenCalledWith('deposit_evaluate', expect.objectContaining({
      outcome: 'failure',
      surface: 'spi',
      errorCode: 'DEPOSIT_TRIGGER_SPI_FAILED',
    }));
  });
});
