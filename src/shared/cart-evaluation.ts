import { items } from '@wix/data';
import { evaluateDepositPlan } from './deposit-engine';
import type { CheckoutLineItem, DepositEvaluationResult, DepositRule } from '../types';
import { listDepositRules } from './rules-store';
import { getAppEntitlement, type GetAppEntitlementOptions } from './entitlement';
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

export function toCheckoutLineItems(order: {
  lineItems?: Array<{
    _id?: string;
    catalogReference?: { catalogItemId?: string };
    productName?: { original?: string | null; translated?: string | null } | null;
    quantity?: number;
    price?: { amount?: string };
    originalPrice?: { amount?: string };
  }>;
}): CheckoutLineItem[] {
  return (order.lineItems ?? []).map(item => ({
    id: item._id,
    catalogItemId: item.catalogReference?.catalogItemId,
    catalogReference: item.catalogReference ? { catalogItemId: item.catalogReference.catalogItemId } : undefined,
    productName: item.productName?.original ?? item.productName?.translated ?? undefined,
    quantity: item.quantity ?? 1,
    price: item.price?.amount ?? item.originalPrice?.amount ?? '0',
  }));
}

export function deferredDiscountPercent(evaluation: DepositEvaluationResult): number {
  if (!evaluation.eligible || evaluation.orderSubtotal <= 0) return 0;
  return Math.round((evaluation.remainingBalance / evaluation.orderSubtotal) * 10000) / 100;
}

/**
 * `query` defaults to the plain (unelevated) `items.query`, matching
 * `listDepositRules`'s own default, for dashboard callers. Backend/SPI
 * callers (which have no merchant session) must pass `auth.elevate(items.query)`
 * or the underlying `items.query(...).find(...)` call fails with
 * "Missing authentication information". Likewise `entitlementOptions` defaults
 * to non-elevated (dashboard-safe); backend/SPI callers must pass `{ elevated: true }`
 * or the entitlement's app-instance lookup fails with 403 Forbidden.
 */
export async function evaluateCartDepositPlans(
  lineItems: ReadonlyArray<unknown> | undefined,
  currency = 'USD',
  query: typeof items.query = items.query,
  entitlementOptions: GetAppEntitlementOptions = {},
) {
  const [rules, entitlement] = await Promise.all([listDepositRules(query), getAppEntitlement(entitlementOptions)]);
  const enabled = restrictRulesForEntitlement(rules.filter(rule => rule.enabled), entitlement);
  const evaluation = evaluateDepositPlan({
    currency,
    lineItems: spiLineItems(lineItems),
    rules: enabled,
  });
  return { evaluation, enabled };
}

/**
 * A single `triggers[i]` entry from the `getEligibleTriggers` SPI request. See
 * https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/custom-discount-triggers-integration-service-plugin/get-eligible-triggers.md
 * The `identifier` here is request-scoped and opaque to us: Wix uses it to
 * correlate our response back to the trigger it asked about, so it must be
 * echoed verbatim in the matching `eligibleTriggers[i].identifier` — it is
 * NOT our own rule id.
 */
export type RequestedTrigger = {
  customTrigger?: { _id?: string | null } | null;
  identifier?: string | null;
};

/**
 * Per the SPI contract, `eligibleTriggers[i].identifier` must equal the
 * `identifier` of the *requested* `triggers[i]` entry we matched (joined via
 * `customTriggerId`/`customTrigger._id`), not our internal rule id. We only
 * return a trigger Wix actually asked about: an eligible rule that wasn't in
 * `requestedTriggers`, or a requested trigger whose `customTrigger._id` we
 * don't recognize, both yield no entry.
 */
export function eligibleDepositTriggers(
  enabled: DepositRule[],
  evaluation: DepositEvaluationResult,
  requestedTriggers: ReadonlyArray<RequestedTrigger> | undefined,
): Array<{ customTriggerId: string; identifier: string }> {
  if (!evaluation.eligible || !evaluation.ruleId || evaluation.remainingBalance <= 0) return [];
  const rule = enabled.find(candidate => candidate.id === evaluation.ruleId);
  if (!rule) return [];
  const customTriggerId = depositTriggerId(rule.id);
  const requested = (requestedTriggers ?? []).find(trigger => trigger.customTrigger?._id === customTriggerId);
  if (!requested?.identifier) return [];
  return [{ customTriggerId, identifier: requested.identifier }];
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
