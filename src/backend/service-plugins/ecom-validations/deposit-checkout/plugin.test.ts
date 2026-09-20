import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@wix/data', () => ({ items: { query: vi.fn() } }));
vi.mock('@wix/essentials', () => ({ auth: { elevate: (fn: unknown) => fn } }));
vi.mock('@wix/ecom/service-plugins', () => ({
  validations: {
    provideHandlers: (handlers: unknown) => handlers,
    Severity: { WARNING: 'WARNING', ERROR: 'ERROR' },
    NameInOther: { OTHER_DEFAULT: 'OTHER_DEFAULT' },
  },
}));

const emitDiagnosticSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/logger')>();
  return { ...actual, emitBackendDiagnostic: emitDiagnosticSpy };
});

const cartEvaluation = vi.hoisted(() => ({
  evaluateCartDepositPlans: vi.fn(),
  checkoutDepositMessage: vi.fn(() => 'A deposit is required for this order.'),
}));
vi.mock('../../../../shared/cart-evaluation', () => cartEvaluation);

import { handleValidation } from './plugin';

describe('deposit-checkout validations SPI failure policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartEvaluation.checkoutDepositMessage.mockReturnValue('A deposit is required for this order.');
  });

  it('returns no violations when the cart is not deposit-eligible', async () => {
    cartEvaluation.evaluateCartDepositPlans.mockResolvedValue({ evaluation: { eligible: false } });
    const response = await handleValidation({ request: { validationInfo: {} }, metadata: {} } as any);
    expect(response).toEqual({ violations: [] });
  });

  it('returns a WARNING violation when the cart is deposit-eligible', async () => {
    cartEvaluation.evaluateCartDepositPlans.mockResolvedValue({ evaluation: { eligible: true } });
    const response = await handleValidation({ request: { validationInfo: {} }, metadata: {} } as any);
    expect(response.violations).toHaveLength(1);
    expect(response.violations![0].severity).toBe('WARNING');
  });

  it('fails open (no violations) rather than propagating an error to the shopper, and emits a failure diagnostic', async () => {
    cartEvaluation.evaluateCartDepositPlans.mockRejectedValue(new Error('elevation/auth failure'));

    await expect(handleValidation({ request: { validationInfo: {} }, metadata: {} } as any)).resolves.toEqual({ violations: [] });

    expect(emitDiagnosticSpy).toHaveBeenCalledWith('deposit_evaluate', expect.objectContaining({
      outcome: 'failure',
      surface: 'spi',
      errorCode: 'DEPOSIT_VALIDATION_SPI_FAILED',
    }));
  });
});
