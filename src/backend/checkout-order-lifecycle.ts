import { orders } from '@wix/ecom';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { evaluateDepositPlan } from './deposit-engine';
import { listDepositRules } from '../shared/rules-store';
import { getAppEntitlement } from '../shared/entitlement';
import { restrictRulesForEntitlement } from '../shared/plan-limits';
import { installmentDueAt } from '../shared/installment-dates';
import {
  PAYMENT_LEDGER_COLLECTION,
  getPaymentLedger,
  money,
  toLedgerRecord,
  type PaymentLedger,
} from '../shared/payment-ledger';
import { syncInstallmentAutomations } from './automation-reporter';
import { createNextRequest } from './payment-request-lifecycle';
import type { CheckoutLineItem, DepositRule } from '../types';
import { emitDiagnostic } from '../shared/logger';

function toCheckoutLineItems(order: {
  lineItems?: Array<{
    _id?: string;
    catalogReference?: { catalogItemId?: string };
    productName?: { original?: string };
    quantity?: number;
    price?: { amount?: string };
    originalPrice?: { amount?: string };
  }>;
}): CheckoutLineItem[] {
  return (order.lineItems ?? []).map(item => ({
    id: item._id,
    catalogItemId: item.catalogReference?.catalogItemId,
    catalogReference: item.catalogReference ? { catalogItemId: item.catalogReference.catalogItemId } : undefined,
    productName: item.productName?.original,
    quantity: item.quantity ?? 1,
    price: item.originalPrice?.amount ?? item.price?.amount ?? '0',
  }));
}

function matchesDepositCheckout(paidAmount: number, expectedDeposit: number): boolean {
  return Math.abs(paidAmount - expectedDeposit) <= 0.02;
}

function ledgerFromCheckoutOrder(
  orderId: string,
  rule: DepositRule,
  currency: string,
  evaluation: ReturnType<typeof evaluateDepositPlan>,
  orderCreatedAt: string,
): PaymentLedger | undefined {
  if (!evaluation.eligible || !evaluation.layawaySchedule) return undefined;
  const baseDate = new Date(orderCreatedAt);
  const frequency = rule.installmentFrequency || 'BIWEEKLY';
  const installments = evaluation.layawaySchedule.schedule
    .filter(item => item.amount > 0)
    .map(item => ({
      installmentNumber: item.installmentNumber,
      amount: money(item.amount),
      status: item.installmentNumber === 0 ? 'PAID' as const : 'PENDING' as const,
      dueAt: installmentDueAt(baseDate, item.installmentNumber, frequency),
    }));
  if (!installments.length) return undefined;
  return {
    _id: orderId,
    orderId,
    ruleId: rule.id,
    currency,
    totalOrderAmount: evaluation.orderSubtotal,
    installments,
  };
}

/** Seeds a ledger when checkout collected only the deposit (usually via paired automatic discount). */
export async function reconcileCheckoutDepositOrder(orderId: string): Promise<PaymentLedger | undefined> {
  if (!orderId) return undefined;
  const existing = await getPaymentLedger(orderId);
  if (existing) return existing;
  const order = await auth.elevate(orders.getOrder)(orderId);
  const paidAmount = money(order.priceSummary?.total?.amount);
  const currency = order.currency;
  if (!currency || paidAmount <= 0) return undefined;
  const [rules, entitlement] = await Promise.all([
    listDepositRules(auth.elevate(items.query)),
    getAppEntitlement(),
  ]);
  const enabled = restrictRulesForEntitlement(rules.filter(rule => rule.enabled), entitlement);
  const lineItems = toCheckoutLineItems(order);
  const createdAt = typeof order._createdDate === 'string'
    ? order._createdDate
    : order._createdDate instanceof Date
      ? order._createdDate.toISOString()
      : new Date().toISOString();
  for (const rule of enabled) {
    if (rule.scope === 'COLLECTION') continue;
    const evaluation = evaluateDepositPlan({ currency, lineItems, rules: [rule], selectedRuleId: rule.id });
    if (!evaluation.eligible || !matchesDepositCheckout(paidAmount, evaluation.depositDueNow)) continue;
    const ledger = ledgerFromCheckoutOrder(orderId, rule, currency, evaluation, createdAt);
    if (!ledger) continue;
    try {
      await auth.elevate(items.insert)(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(ledger));
    } catch {
      const created = await getPaymentLedger(orderId);
      if (created) return created;
      continue;
    }
    await syncInstallmentAutomations(ledger);
    const withNext = await createNextRequest(ledger);
    emitDiagnostic('checkout_deposit_seed', { outcome: 'success', surface: 'backend' });
    return withNext;
  }
  return undefined;
}
