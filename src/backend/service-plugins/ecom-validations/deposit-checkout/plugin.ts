import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { validations } from '@wix/ecom/service-plugins';
import { checkoutDepositMessage, evaluateCartDepositPlans } from '../../../../shared/cart-evaluation';
import { emitBackendDiagnostic as emitDiagnostic } from '../../../../shared/logger';

const toDescription = (message: string) => message.trim().slice(0, 1000);

export const handleValidation: Parameters<typeof validations.provideHandlers>[0]['getValidationViolations'] = async (payload) => {
  const start = Date.now();
  try {
    const info = payload.request?.validationInfo ?? {};
    const currency = payload.metadata?.currency ?? 'USD';
    // This SPI handler runs server-side with no merchant session, so the
    // underlying `items.query` call in `evaluateCartDepositPlans` must be
    // elevated or it fails with "Missing authentication information" —
    // matching the sibling `deposit-triggers` plugin's `auth.elevate(items.query)`.
    // Its entitlement lookup needs `{ elevated: true }` for the same reason.
    const { evaluation } = await evaluateCartDepositPlans(info.lineItems, currency, auth.elevate(items.query), { elevated: true });
    if (!evaluation.eligible) {
      emitDiagnostic('deposit_evaluate', { outcome: 'success', surface: 'spi', durationMs: Date.now() - start });
      return { violations: [] };
    }
    emitDiagnostic('deposit_evaluate', { outcome: 'success', surface: 'spi', durationMs: Date.now() - start });
    return {
      violations: [{
        severity: validations.Severity.WARNING,
        description: toDescription(checkoutDepositMessage(evaluation)),
        target: { other: { name: validations.NameInOther.OTHER_DEFAULT } },
      }],
    };
  } catch (error) {
    emitDiagnostic('deposit_evaluate', {
      outcome: 'failure',
      surface: 'spi',
      durationMs: Date.now() - start,
      errorCode: 'DEPOSIT_VALIDATION_SPI_FAILED',
    });
    // Fail open: portfolio-wide checkout-SPI failure policy (see
    // workflows/02-service-plugins-spi-development.md) is fail-open-with-diagnostic
    // for every checkout-path SPI, this one included. This handler only ever
    // returns severity WARNING (never ERROR), so re-throwing bought no extra
    // safety even before this change — it only risked degrading the shopper's
    // checkout on an unrelated backend hiccup (e.g. an elevation/entitlement
    // failure). No violations rather than an error reaching the shopper.
    return { violations: [] };
  }
};

export default validations.provideHandlers({ getValidationViolations: handleValidation });
