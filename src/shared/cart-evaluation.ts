import { evaluateDepositPlan } from '../backend/deposit-engine';
import type { CheckoutLineItem, DepositEvaluationResult, DepositRule } from '../types';
import { listDepositRules } from './rules-store';
import { getAppEntitlement } from './entitlement';
import { restrictRulesForEntitlement } from './plan-limits';
import { depositTriggerId } from './deposit-trigger-id';

export function spiLineItems(lineItems: ReadonlyArray<unknown> | undefined): CheckoutLineItem[] {
  return (lineItems ?? []).map((item, index) => {
    const record = item as {
      quantity?: number | null;
      price?: { amount?: string } | string;
      productName?: { original?: string | null; translated?: string | null };
      catalogReference?: {
        catalogItemId?: string;
        options?: Record<string, unknown> | null;
      };
    };
    const price = typeof record.price === 'string' ? record.price : record.price?.amount ?? '0';
    return {
      id: String(index),
      catalogItemId: record.catalogReference?.catalogItemId,
      catalogReference: record.catalogReference?.catalogItemId
        ? { catalogItemId: record.catalogReference.catalogItemId, options: record.catalogReference.options ?? undefined }
        : undefined,
      productName: record.productName?.original ?? record.productName?.translated ?? undefined,
      quantity: record.quantity ?? 1,
      price,
    };
  });
}

export function deferredDiscountPercent(evaluation: DepositEvaluationResult): number {
  if (!evaluation.eligible || evaluation.orderSubtotal <= 0) return 0;
  return Math.round((evaluation.remainingBalance / evaluation.orderSubtotal) * 10000) / 100;
}

export async function evaluateCartDepositPlans(lineItems: ReadonlyArray<unknown> | undefined, currency = 'USD') {
  const [rules, entitlement] = await Promise.all([listDepositRules(), getAppEntitlement()]);
  const enabled = restrictRulesForEntitlement(rules.filter(rule => rule.enabled), entitlement);
  const evaluation = evaluateDepositPlan({
    currency,
    lineItems: spiLineItems(lineItems),
    rules: enabled,
  });
  return { evaluation, enabled };
}

export function eligibleDepositTriggers(
  enabled: DepositRule[],
  evaluation: DepositEvaluationResult,
): Array<{ customTriggerId: string; identifier: string }> {
  if (!evaluation.eligible || !evaluation.ruleId || evaluation.remainingBalance <= 0) return [];
  const rule = enabled.find(candidate => candidate.id === evaluation.ruleId);
  if (!rule) return [];
  return [{ customTriggerId: depositTriggerId(rule.id), identifier: rule.id }];
}

export function checkoutDepositMessage(evaluation: DepositEvaluationResult): string {
  if (!evaluation.eligible || !evaluation.ruleName) {
    return evaluation.breakdownReasons.join(' ') || 'This cart does not qualify for a DepositCraft layaway plan.';
  }
  const deferred = deferredDiscountPercent(evaluation);
  return [
    `${evaluation.ruleName}: pay $${evaluation.depositDueNow.toFixed(2)} today`,
    evaluation.remainingBalance > 0
      ? `($${evaluation.remainingBalance.toFixed(2)} deferred in ${evaluation.layawaySchedule?.installmentsCount ?? 0} installments).`
      : 'at checkout.',
    deferred > 0
      ? `Pair the "${evaluation.ruleName}" discount trigger with a ${deferred.toFixed(2)}% automatic discount so checkout collects only the deposit.`
      : '',
  ].filter(Boolean).join(' ');
}
