import { orderPaymentRequests, orders } from '@wix/ecom';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { evaluateDepositPlan } from './deposit-engine';
import { COLLECTION_ID } from '../shared/configuration';
import { getAppEntitlement } from '../shared/entitlement';
import { evaluateRuleAgainstPlan } from '../shared/plan-limits';
import {
  PAYMENT_LEDGER_COLLECTION,
  PaymentLedger,
  getPaymentLedger,
  money,
  paymentRequestExternalId,
  startedPlan,
  toLedgerRecord,
  type StartedPaymentPlan,
} from '../shared/payment-ledger';
import { CheckoutLineItem, DepositRule } from '../types';
import { syncInstallmentAutomations } from './automation-reporter';

export type { StartedPaymentPlan } from '../shared/payment-ledger';

const inFlightByOrder = new Map<string, Promise<unknown>>();
async function withOrderLock<T>(orderId: string, work: () => Promise<T>): Promise<T> {
  const previous = inFlightByOrder.get(orderId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  inFlightByOrder.set(orderId, previous.then(() => current));
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (inFlightByOrder.get(orderId) === current) inFlightByOrder.delete(orderId);
  }
}

/**
 * ROOT CAUSE FIX: this used to probe with `collections.getDataCollection`,
 * which requires `SCOPE.DC-DATA.DATA-COLLECTIONS-MANAGE` -- a scope
 * DepositCraft (like every app in this portfolio) does not hold, so this
 * 403'd permanently. It now probes with `items.query(...).limit(1).find(...)`,
 * which only needs `SCOPE.DC-DATA.READ` (a scope this app already holds for
 * ledger reads/writes). See `packages/core/src/storage/probe.ts`.
 */
export async function initializePaymentLedger(): Promise<void> {
  try {
    await auth.elevate(items.query)(PAYMENT_LEDGER_COLLECTION).limit(1).find({ consistentRead: true });
  } catch {
    throw new Error('Private storage is not ready on this site. Install or update the app, wait up to five minutes, then click Retry.');
  }
}

function toCheckoutLineItems(order: {
  lineItems?: Array<{
    _id?: string;
    catalogReference?: { catalogItemId?: string };
    productName?: { original?: string };
    quantity?: number;
    price?: { amount?: string };
  }>;
}): CheckoutLineItem[] {
  return (order.lineItems ?? []).map(item => ({
    id: item._id,
    catalogItemId: item.catalogReference?.catalogItemId,
    catalogReference: item.catalogReference ? { catalogItemId: item.catalogReference.catalogItemId } : undefined,
    productName: item.productName?.original,
    quantity: item.quantity ?? 1,
    price: item.price?.amount ?? '0',
  }));
}

async function loadSavedPlan(ruleId: string): Promise<DepositRule> {
  const configuration = await auth.elevate(items.query)(COLLECTION_ID).eq('_id', 'configuration').find({ consistentRead: true });
  const rules = (configuration.items[0]?.payload?.entries as DepositRule[] | undefined) ?? [];
  const rule = rules.find(candidate => candidate.id === ruleId && candidate.enabled);
  if (!rule) throw new Error('The selected DepositCraft plan is not active.');
  return rule;
}

async function paymentUrl(paymentRequestId: string): Promise<string> {
  const response = await auth.elevate(orderPaymentRequests.getOrderPaymentRequestUrl)(paymentRequestId);
  if (!response.orderPaymentRequestUrl) throw new Error('Wix did not return a payment-request URL.');
  return response.orderPaymentRequestUrl;
}

export async function createNextRequest(ledger: PaymentLedger): Promise<PaymentLedger> {
  const next = ledger.installments.find(item => item.status === 'PENDING' && !item.paymentRequestId);
  if (!next) return ledger;
  const creating = {
    ...ledger,
    installments: ledger.installments.map(item => (
      item.installmentNumber === next.installmentNumber ? { ...item, status: 'CREATING' as const } : item
    )),
  };
  await auth.elevate(items.save)(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(creating));
  const externalId = paymentRequestExternalId(ledger.orderId, next.installmentNumber);
  const existing = await auth.elevate(orderPaymentRequests.queryOrderPaymentRequests)().eq('source.externalId', externalId).find();
  const paymentRequest = existing.items[0] ?? await auth.elevate(orderPaymentRequests.createOrderPaymentRequest)({
    orderPaymentRequest: {
      orderId: ledger.orderId,
      amount: { amount: next.amount.toFixed(2) },
      source: { externalId },
      title: next.installmentNumber === 0 ? 'Deposit payment' : `Layaway installment ${next.installmentNumber}`,
      description: `DepositCraft payment ${next.installmentNumber + 1}`,
    },
  });
  const paymentRequestId = paymentRequest._id;
  if (!paymentRequestId) throw new Error('Wix did not return an order payment request ID.');
  const url = await paymentUrl(paymentRequestId);
  const updated = {
    ...creating,
    installments: creating.installments.map(item => (
      item.installmentNumber === next.installmentNumber
        ? { ...item, status: 'PENDING' as const, paymentRequestId, paymentRequestUrl: url }
        : item
    )),
  };
  await auth.elevate(items.save)(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(updated));
  await syncInstallmentAutomations(updated);
  return updated;
}

/** Callers supply only IDs. This server-side flow reads the saved plan and verified Wix order itself. */
export async function startExistingOrderPaymentPlan(orderId: string, ruleId: string): Promise<StartedPaymentPlan> {
  if (!orderId || !ruleId) throw new Error('An existing Wix order ID and saved plan ID are required.');
  return withOrderLock(orderId, async () => {
    const existing = await getPaymentLedger(orderId, auth.elevate(items.get));
    if (existing) return startedPlan(existing);
    const [order, rule, entitlement] = await Promise.all([
      auth.elevate(orders.getOrder)(orderId),
      loadSavedPlan(ruleId),
      getAppEntitlement({ elevated: true }),
    ]);
    const gate = evaluateRuleAgainstPlan(rule, entitlement, 0);
    if (!gate.allowed) throw new Error(gate.message ?? 'This plan is not available on the current billing plan.');
    const currency = order.currency;
    const totalOrderAmount = money(order.priceSummary?.total?.amount);
    if (!currency || totalOrderAmount <= 0) throw new Error('Wix did not return a payable order total and currency.');
    if (rule.scope === 'COLLECTION') {
      throw new Error('Collection-scoped plans cannot be verified from an order without a catalog collection lookup. Choose an all-products or specific-products plan.');
    }
    const evaluation = evaluateDepositPlan({
      currency,
      lineItems: toCheckoutLineItems(order),
      rules: [rule],
      selectedRuleId: rule.id,
    });
    if (!evaluation.eligible || !evaluation.layawaySchedule) {
      throw new Error(evaluation.breakdownReasons.join(' ') || 'The saved plan is not eligible for this order.');
    }
    const schedule = evaluation.layawaySchedule;
    if (Math.abs(schedule.totalOrderAmount - totalOrderAmount) > 0.001) {
      throw new Error('The saved plan did not calculate against Wix’s verified order total.');
    }
    const installments = schedule.schedule
      .filter(item => item.amount > 0)
      .map(item => ({ installmentNumber: item.installmentNumber, amount: money(item.amount), status: 'PENDING' as const }));
    if (!installments.length) throw new Error('The saved plan has no amount to collect.');
    const ledger: PaymentLedger = { _id: orderId, orderId, ruleId: rule.id, currency, totalOrderAmount, installments };
    try {
      await auth.elevate(items.insert)(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(ledger));
    } catch {
      const createdByAnotherRequest = await getPaymentLedger(orderId, auth.elevate(items.get));
      if (createdByAnotherRequest) return startedPlan(createdByAnotherRequest);
      throw new Error('DepositCraft could not create the order payment ledger.');
    }
    return startedPlan(await createNextRequest(ledger));
  });
}

/** Advances only from Wix's PAID webhook. It never charges a saved payment method. */
export async function handleOrderPaymentRequestPaid(paymentRequestId: string, orderId?: string): Promise<void> {
  if (!paymentRequestId || !orderId) return;
  await withOrderLock(orderId, async () => {
    const ledger = await getPaymentLedger(orderId, auth.elevate(items.get));
    if (!ledger) return;
    const current = ledger.installments.find(item => item.paymentRequestId === paymentRequestId);
    if (!current || current.status === 'PAID') return;
    const paid = {
      ...ledger,
      installments: ledger.installments.map(item => (
        item.paymentRequestId === paymentRequestId ? { ...item, status: 'PAID' as const } : item
      )),
    };
    await auth.elevate(items.save)(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(paid));
    await syncInstallmentAutomations(paid);
    await createNextRequest(paid);
  });
}
