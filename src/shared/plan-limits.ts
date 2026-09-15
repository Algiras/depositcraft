import type { AppEntitlement } from './entitlement';
import type { DepositRule, InstallmentFrequency } from '../types';

/**
 * Derived from ../publishing_config.json pricing.plans benefits:
 *  - Basic (free): "Up to 2 active deposit schedules", "Percentage deposit options"
 *  - Pro: "Unlimited deposit & layaway plans", "Custom installment frequencies"
 * Do not edit publishing_config.json - this module mirrors it in enforceable code.
 */
export const FREE_PLAN_MAX_ACTIVE_RULES = 2;
export const FREE_PLAN_FIXED_FREQUENCY: InstallmentFrequency = 'BIWEEKLY';

export type PlanGateReason = 'FREE_RULE_LIMIT' | 'FREE_FIXED_DEPOSIT' | 'FREE_CUSTOM_FREQUENCY';

export interface PlanGateResult {
  allowed: boolean;
  reason?: PlanGateReason;
  message?: string;
}

const isPaid = (entitlement: AppEntitlement): boolean => entitlement.status === 'paid';

/** Basic plan benefit: "Percentage deposit options" - fixed-amount deposits are Pro-only. */
export function canUseFixedDeposit(entitlement: AppEntitlement): boolean {
  return isPaid(entitlement);
}

/** Pro benefit: "Custom installment frequencies" - free plans use a single default cadence. */
export function canUseCustomFrequency(entitlement: AppEntitlement): boolean {
  return isPaid(entitlement);
}

/** Basic plan benefit: "Up to 2 active deposit schedules". */
export function canActivateAnotherRule(entitlement: AppEntitlement, currentActiveCount: number): boolean {
  return isPaid(entitlement) || currentActiveCount < FREE_PLAN_MAX_ACTIVE_RULES;
}

/**
 * Checks whether saving/enabling `rule` as configured is allowed under `entitlement`.
 * `activeCountExcludingThisRule` should not include this rule's own current enabled state.
 */
/** Filters rules a free instance may enforce at checkout (mirrors dashboard gating). */
export function restrictRulesForEntitlement(rules: DepositRule[], entitlement: AppEntitlement): DepositRule[] {
  if (isPaid(entitlement)) return rules;
  return rules.filter(rule => evaluateRuleAgainstPlan(rule, entitlement, 0).allowed);
}

export function evaluateRuleAgainstPlan(
  rule: Pick<DepositRule, 'depositType' | 'installmentFrequency' | 'enabled'>,
  entitlement: AppEntitlement,
  activeCountExcludingThisRule: number
): PlanGateResult {
  if (isPaid(entitlement)) return { allowed: true };

  if (rule.depositType === 'FIXED') {
    return {
      allowed: false,
      reason: 'FREE_FIXED_DEPOSIT',
      message: 'Fixed-amount deposits need the Pro plan. The free plan supports percentage-based deposits.',
    };
  }

  if (rule.installmentFrequency && rule.installmentFrequency !== FREE_PLAN_FIXED_FREQUENCY) {
    return {
      allowed: false,
      reason: 'FREE_CUSTOM_FREQUENCY',
      message: 'Custom installment schedules need the Pro plan. The free plan uses a bi-weekly schedule.',
    };
  }

  if (rule.enabled && !canActivateAnotherRule(entitlement, activeCountExcludingThisRule)) {
    return {
      allowed: false,
      reason: 'FREE_RULE_LIMIT',
      message: `The free plan supports up to ${FREE_PLAN_MAX_ACTIVE_RULES} active deposit plans. Upgrade to Pro for unlimited plans.`,
    };
  }

  return { allowed: true };
}
