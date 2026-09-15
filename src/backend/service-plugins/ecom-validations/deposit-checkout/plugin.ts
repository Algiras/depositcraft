import { validations } from '@wix/ecom/service-plugins';
import { checkoutDepositMessage, evaluateCartDepositPlans } from '../../../../shared/cart-evaluation';
import { emitDiagnostic } from '../../../../shared/logger';

const toDescription = (message: string) => message.trim().slice(0, 1000);

export const handleValidation: Parameters<typeof validations.provideHandlers>[0]['getValidationViolations'] = async (payload) => {
  const start = Date.now();
  try {
    const info = payload.request?.validationInfo ?? {};
    const currency = payload.metadata?.currency ?? 'USD';
    const { evaluation } = await evaluateCartDepositPlans(info.lineItems, currency);
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
    throw error;
  }
};

export default validations.provideHandlers({ getValidationViolations: handleValidation });
