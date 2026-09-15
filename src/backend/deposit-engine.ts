import {
  DepositRule,
  CheckoutLineItem,
  DepositEvaluationInput,
  DepositEvaluationResult,
  LayawaySchedule,
  InstallmentScheduleItem,
} from '../types';
import { logger } from '../shared/logger';

/**
 * Extracts product ID supporting both Catalog V1 (catalogItemId) and Catalog V3 (catalogReference).
 */
export function getProductId(item: CheckoutLineItem): string | undefined {
  if (item.catalogReference?.catalogItemId) {
    return item.catalogReference.catalogItemId;
  }
  if (item.catalogItemId) {
    return item.catalogItemId;
  }
  return item.id;
}

/**
 * Extracts associated collection IDs for an item.
 */
export function getItemCollections(item: CheckoutLineItem): string[] {
  const collections: string[] = [];
  if (Array.isArray(item.collectionIds)) {
    collections.push(...item.collectionIds);
  }
  if (item.categoryId && !collections.includes(item.categoryId)) {
    collections.push(item.categoryId);
  }
  if (item.catalogReference?.options?.collectionId) {
    const optCol = String(item.catalogReference.options.collectionId);
    if (!collections.includes(optCol)) {
      collections.push(optCol);
    }
  }
  return collections;
}

/**
 * Safely parses item price into a valid non-negative number.
 */
export function parseItemPrice(price: string | number): number {
  const num = typeof price === 'number' ? price : parseFloat(String(price || '0'));
  return isNaN(num) || num < 0 ? 0 : num;
}

/**
 * Calculates subtotal for given line items with 2 decimal places precision.
 */
export function calculateSubtotal(items: CheckoutLineItem[]): number {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const raw = items.reduce((acc, item) => {
    const qty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
    return acc + parseItemPrice(item.price) * qty;
  }, 0);
  return Math.round(raw * 100) / 100;
}

/**
 * Filters line items that match the rule's targeting criteria.
 */
export function filterQualifyingItems(items: CheckoutLineItem[], rule: DepositRule): CheckoutLineItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  switch (rule.scope) {
    case 'ALL_PRODUCTS':
      return items;

    case 'COLLECTION': {
      if (!rule.targetCollectionIds || rule.targetCollectionIds.length === 0) {
        return [];
      }
      return items.filter(item => {
        const itemCols = getItemCollections(item);
        return rule.targetCollectionIds!.some(target => itemCols.includes(target));
      });
    }

    case 'SPECIFIC_PRODUCTS': {
      if (!rule.targetProductIds || rule.targetProductIds.length === 0) {
        return [];
      }
      return items.filter(item => {
        const pid = getProductId(item);
        return pid ? rule.targetProductIds!.includes(pid) : false;
      });
    }

    default:
      return items;
  }
}

/**
 * Generates an installment payment schedule for the remaining layaway balance.
 */
export function buildLayawaySchedule(
  totalOrderAmount: number,
  depositDueNow: number,
  installmentsCount: number,
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' = 'BIWEEKLY'
): LayawaySchedule {
  const remainingBalance = Math.max(0, Math.round((totalOrderAmount - depositDueNow) * 100) / 100);

  if (installmentsCount <= 0 || remainingBalance <= 0) {
    return {
      totalOrderAmount,
      depositDueNow,
      remainingBalance: 0,
      installmentsCount: 0,
      installmentAmount: 0,
      frequency,
      schedule: [
        {
          installmentNumber: 0,
          label: 'Initial Deposit (Due Now)',
          amount: depositDueNow,
          dueDescription: 'At Checkout',
        },
      ],
    };
  }

  const baseInstallment = Math.floor((remainingBalance / installmentsCount) * 100) / 100;
  const schedule: InstallmentScheduleItem[] = [
    {
      installmentNumber: 0,
      label: 'Initial Deposit (Due Now)',
      amount: depositDueNow,
      dueDescription: 'At Checkout',
    },
  ];

  let accumulated = 0;
  for (let i = 1; i <= installmentsCount; i++) {
    const isLast = i === installmentsCount;
    const amount = isLast
      ? Math.round((remainingBalance - accumulated) * 100) / 100
      : baseInstallment;

    accumulated += amount;

    const dueDescription = `In ${i * (frequency === 'WEEKLY' ? 1 : frequency === 'BIWEEKLY' ? 2 : 4)} weeks`;

    schedule.push({
      installmentNumber: i,
      label: `Layaway Installment #${i}`,
      amount,
      dueDescription,
    });
  }

  return {
    totalOrderAmount,
    depositDueNow,
    remainingBalance,
    installmentsCount,
    installmentAmount: baseInstallment,
    frequency,
    schedule,
  };
}

/**
 * Evaluates a deposit and layaway rule against a customer checkout.
 */
export function evaluateDepositPlan(input: DepositEvaluationInput): DepositEvaluationResult {
  const orderSubtotal = calculateSubtotal(input.lineItems);
  const reasons: string[] = [];

  if (orderSubtotal <= 0) {
    return {
      eligible: false,
      orderSubtotal: 0,
      qualifyingSubtotal: 0,
      depositDueNow: 0,
      remainingBalance: 0,
      breakdownReasons: ['Order subtotal is zero or empty.'],
    };
  }

  const activeRules = (input.rules || []).filter(r => r.enabled);
  if (activeRules.length === 0) {
    return {
      eligible: false,
      orderSubtotal,
      qualifyingSubtotal: 0,
      depositDueNow: orderSubtotal,
      remainingBalance: 0,
      breakdownReasons: ['No active deposit or layaway plans configured.'],
    };
  }

  // Find targeted or best rule
  let rule: DepositRule | undefined;
  if (input.selectedRuleId) {
    rule = activeRules.find(r => r.id === input.selectedRuleId);
  } else {
    // Sort by priority or pick first matching min threshold
    rule = activeRules.find(r => {
      if (r.minOrderSubtotal && orderSubtotal < r.minOrderSubtotal) return false;
      const qualifying = filterQualifyingItems(input.lineItems, r);
      return qualifying.length > 0;
    }) || activeRules[0];
  }

  if (!rule) {
    return {
      eligible: false,
      orderSubtotal,
      qualifyingSubtotal: 0,
      depositDueNow: orderSubtotal,
      remainingBalance: 0,
      breakdownReasons: ['No suitable deposit plan found for this cart.'],
    };
  }

  // Verify minimum order subtotal threshold
  if (rule.minOrderSubtotal !== undefined && orderSubtotal < rule.minOrderSubtotal) {
    return {
      eligible: false,
      ruleId: rule.id,
      ruleName: rule.name,
      orderSubtotal,
      qualifyingSubtotal: 0,
      depositDueNow: orderSubtotal,
      remainingBalance: 0,
      breakdownReasons: [
        `Order subtotal ($${orderSubtotal.toFixed(2)}) is below the required minimum threshold of $${rule.minOrderSubtotal.toFixed(2)} for ${rule.name}.`,
      ],
    };
  }

  // Filter qualifying items for the rule
  const qualifyingItems = filterQualifyingItems(input.lineItems, rule);
  const qualifyingSubtotal = calculateSubtotal(qualifyingItems);
  const nonQualifyingSubtotal = Math.max(0, Math.round((orderSubtotal - qualifyingSubtotal) * 100) / 100);

  if (qualifyingSubtotal <= 0) {
    return {
      eligible: false,
      ruleId: rule.id,
      ruleName: rule.name,
      orderSubtotal,
      qualifyingSubtotal: 0,
      depositDueNow: orderSubtotal,
      remainingBalance: 0,
      breakdownReasons: [
        `None of the items in the cart qualify for ${rule.name} based on collection or product targeting.`,
      ],
    };
  }

  // Calculate required deposit on qualifying items
  let depositOnQualifying = 0;
  if (rule.depositType === 'PERCENTAGE') {
    const pct = Math.min(100, Math.max(1, rule.depositValue));
    depositOnQualifying = Math.round((qualifyingSubtotal * (pct / 100)) * 100) / 100;
    reasons.push(`${pct}% deposit applied to qualifying items ($${qualifyingSubtotal.toFixed(2)}).`);
  } else {
    depositOnQualifying = Math.min(qualifyingSubtotal, Math.max(0, rule.depositValue));
    reasons.push(`Fixed deposit of $${depositOnQualifying.toFixed(2)} applied to qualifying items.`);
  }

  // Total deposit due now includes the required deposit on qualifying items + 100% of non-qualifying items
  const depositDueNow = Math.round((depositOnQualifying + nonQualifyingSubtotal) * 100) / 100;
  const remainingBalance = Math.max(0, Math.round((orderSubtotal - depositDueNow) * 100) / 100);

  if (nonQualifyingSubtotal > 0) {
    reasons.push(`Non-qualifying items ($${nonQualifyingSubtotal.toFixed(2)}) are due in full at checkout.`);
  }

  // Layaway schedule breakdown
  const layawaySchedule = buildLayawaySchedule(
    orderSubtotal,
    depositDueNow,
    rule.layawayInstallments,
    rule.installmentFrequency || 'BIWEEKLY'
  );

  if (rule.layawayInstallments > 0 && remainingBalance > 0) {
    reasons.push(
      `Remaining balance of $${remainingBalance.toFixed(2)} scheduled across ${rule.layawayInstallments} ${rule.installmentFrequency || 'BIWEEKLY'} installments.`
    );
  }

  logger.trackUsage('DEPOSIT_CALCULATED', {
    ruleId: rule.id,
    orderSubtotal,
    qualifyingSubtotal,
    depositDueNow,
    remainingBalance,
    installments: rule.layawayInstallments,
  });

  return {
    eligible: true,
    ruleId: rule.id,
    ruleName: rule.name,
    depositType: rule.depositType,
    depositValue: rule.depositValue,
    orderSubtotal,
    qualifyingSubtotal,
    depositDueNow,
    remainingBalance,
    layawaySchedule,
    breakdownReasons: reasons,
  };
}
