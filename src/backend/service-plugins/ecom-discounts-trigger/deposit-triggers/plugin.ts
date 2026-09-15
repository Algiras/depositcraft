import { customTriggers } from '@wix/ecom/service-plugins';
import { eligibleDepositTriggers, evaluateCartDepositPlans } from '../../../../shared/cart-evaluation';
import { depositTriggerId, depositTriggerName } from '../../../../shared/deposit-trigger-id';
import { listDepositRules } from '../../../../shared/rules-store';
import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { getAppEntitlement } from '../../../../shared/entitlement';
import { restrictRulesForEntitlement } from '../../../../shared/plan-limits';
import { emitDiagnostic } from '../../../../shared/logger';

async function enabledRules() {
  const [rules, entitlement] = await Promise.all([
    listDepositRules(auth.elevate(items.query)),
    getAppEntitlement(),
  ]);
  return restrictRulesForEntitlement(rules.filter(rule => rule.enabled), entitlement);
}

export const handleEligibleTriggers: Parameters<typeof customTriggers.provideHandlers>[0]['getEligibleTriggers'] = async (payload) => {
  const start = Date.now();
  try {
    const currency = payload.metadata?.currency ?? 'USD';
    const lineItems = payload.request?.lineItems;
    const { evaluation, enabled } = await evaluateCartDepositPlans(lineItems, currency);
    const eligibleTriggers = eligibleDepositTriggers(enabled, evaluation);
    emitDiagnostic('deposit_evaluate', { outcome: 'success', surface: 'spi', durationMs: Date.now() - start });
    return { eligibleTriggers };
  } catch (error) {
    emitDiagnostic('deposit_evaluate', {
      outcome: 'failure',
      surface: 'spi',
      durationMs: Date.now() - start,
      errorCode: 'DEPOSIT_TRIGGER_SPI_FAILED',
    });
    throw error;
  }
};

export const handleListTriggers: Parameters<typeof customTriggers.provideHandlers>[0]['listTriggers'] = async () => {
  const rules = await enabledRules();
  return {
    customTriggers: rules.map(rule => ({
      _id: depositTriggerId(rule.id),
      name: depositTriggerName(rule.name),
    })),
  };
};

export default customTriggers.provideHandlers({
  getEligibleTriggers: handleEligibleTriggers,
  listTriggers: handleListTriggers,
});
