import { customTriggers } from '@wix/ecom/service-plugins';
import { eligibleDepositTriggers, evaluateCartDepositPlans } from '../../../../shared/cart-evaluation';
import { depositTriggerId, depositTriggerName } from '../../../../shared/deposit-trigger-id';
import { listDepositRules } from '../../../../shared/rules-store';
import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { getAppEntitlement } from '../../../../shared/entitlement';
import { restrictRulesForEntitlement } from '../../../../shared/plan-limits';
import { emitBackendDiagnostic as emitDiagnostic } from '../../../../shared/logger';

async function enabledRules() {
  const [rules, entitlement] = await Promise.all([
    listDepositRules(auth.elevate(items.query)),
    getAppEntitlement({ elevated: true }),
  ]);
  return restrictRulesForEntitlement(rules.filter(rule => rule.enabled), entitlement);
}

export const handleEligibleTriggers: Parameters<typeof customTriggers.provideHandlers>[0]['getEligibleTriggers'] = async (payload) => {
  const start = Date.now();
  try {
    const currency = payload.metadata?.currency ?? 'USD';
    const lineItems = payload.request?.lineItems;
    // The triggers Wix is asking us to evaluate. Each carries a request-scoped
    // `identifier` that we must echo back verbatim (see `eligibleDepositTriggers`);
    // it is not present when e.g. called without any triggers to filter by.
    const requestedTriggers = payload.request?.triggers;
    // Same elevation as `enabledRules()` below: this SPI handler is backend-only
    // and `evaluateCartDepositPlans`'s underlying `items.query` call needs
    // `auth.elevate` or it fails with "Missing authentication information";
    // its entitlement lookup needs `{ elevated: true }` for the same reason.
    const { evaluation, enabled } = await evaluateCartDepositPlans(lineItems, currency, auth.elevate(items.query), { elevated: true });
    const eligibleTriggers = eligibleDepositTriggers(enabled, evaluation, requestedTriggers);
    emitDiagnostic('deposit_evaluate', { outcome: 'success', surface: 'spi', durationMs: Date.now() - start });
    return { eligibleTriggers };
  } catch (error) {
    emitDiagnostic('deposit_evaluate', {
      outcome: 'failure',
      surface: 'spi',
      durationMs: Date.now() - start,
      errorCode: 'DEPOSIT_TRIGGER_SPI_FAILED',
    });
    // Fail open: portfolio-wide checkout-SPI failure policy (see
    // workflows/02-service-plugins-spi-development.md). No eligible triggers
    // rather than an error reaching the shopper or blocking their checkout;
    // the diagnostic above keeps the failure observable.
    return { eligibleTriggers: [] };
  }
};

export const handleListTriggers: Parameters<typeof customTriggers.provideHandlers>[0]['listTriggers'] = async () => {
  const start = Date.now();
  try {
    const rules = await enabledRules();
    emitDiagnostic('deposit_evaluate', { outcome: 'success', surface: 'spi', durationMs: Date.now() - start });
    return {
      customTriggers: rules.map(rule => ({
        _id: depositTriggerId(rule.id),
        name: depositTriggerName(rule.name),
      })),
    };
  } catch (error) {
    emitDiagnostic('deposit_evaluate', {
      outcome: 'failure',
      surface: 'spi',
      durationMs: Date.now() - start,
      errorCode: 'DEPOSIT_TRIGGER_LIST_SPI_FAILED',
    });
    // Fail open, matching `handleEligibleTriggers` above: no triggers rather
    // than propagating a backend/storage error out of this SPI handler.
    return { customTriggers: [] };
  }
};

export default customTriggers.provideHandlers({
  getEligibleTriggers: handleEligibleTriggers,
  listTriggers: handleListTriggers,
});
