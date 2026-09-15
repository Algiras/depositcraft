import { orderPaymentRequests, orders } from '@wix/ecom';
import { items } from '@wix/data';
import { evaluateDepositPlan } from '../backend/deposit-engine';
import { COLLECTION_ID, loadConfiguration } from './configuration';
import { getAppEntitlement } from './entitlement';
import { evaluateRuleAgainstPlan } from './plan-limits';
import {
  PAYMENT_LEDGER_COLLECTION,
  PaymentLedger,
  getPaymentLedger,
  money,
  paymentRequestExternalId,
  startedPlan,
  toLedgerRecord,
  type StartedPaymentPlan,
} from './payment-ledger';
import { installmentDueAt } from './installment-dates';
import { CheckoutLineItem, DepositRule } from '../types';
import { syncInstallmentAutomations } from '../backend/automation-reporter';

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
  const rules = await loadConfiguration<DepositRule>();
  const rule = rules.find(candidate => candidate.id === ruleId && candidate.enabled);
  if (!rule) throw new Error('The selected DepositCraft plan is not active.');
  return rule;
}

async function paymentUrl(paymentRequestId: string): Promise<string> {
  const response = await orderPaymentRequests.getOrderPaymentRequestUrl(paymentRequestId);
  if (!response.orderPaymentRequestUrl) throw new Error('Wix did not return a payment-request URL.');
  return response.orderPaymentRequestUrl;
}

async function createNextRequest(ledger: PaymentLedger): Promise<PaymentLedger> {
  const next = ledger.installments.find(item => item.status === 'PENDING' && !item.paymentRequestId);
  if (!next) return ledger;
  const creating = {
    ...ledger,
    installments: ledger.installments.map(item => (
      item.installmentNumber === next.installmentNumber ? { ...item, status: 'CREATING' as const } : item
    )),
  };
  await items.save(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(creating));
  const externalId = paymentRequestExternalId(ledger.orderId, next.installmentNumber);
  const existing = await orderPaymentRequests.queryOrderPaymentRequests().eq('source.externalId', externalId).find();
  const paymentRequest = existing.items[0] ?? await orderPaymentRequests.createOrderPaymentRequest({
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
  await items.save(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(updated));
  await syncInstallmentAutomations(updated);
  return updated;
}

/** Dashboard-safe payment plan start using the merchant session (requires Manage Stores scope). */
export async function startPaymentPlanForOrder(orderId: string, ruleId: string): Promise<StartedPaymentPlan> {
  if (!orderId || !ruleId) throw new Error('An existing Wix order ID and saved plan ID are required.');
  return withOrderLock(orderId, async () => {
    const existing = await getPaymentLedger(orderId);
    if (existing) return startedPlan(existing);
    const [order, rule, entitlement] = await Promise.all([
      orders.getOrder(orderId),
      loadSavedPlan(ruleId),
      getAppEntitlement(),
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
    const baseDate = new Date();
    const frequency = rule.installmentFrequency || 'BIWEEKLY';
    const installments = schedule.schedule
      .filter(item => item.amount > 0)
      .map(item => ({
        installmentNumber: item.installmentNumber,
        amount: money(item.amount),
        status: 'PENDING' as const,
        dueAt: installmentDueAt(baseDate, item.installmentNumber, frequency),
      }));
    if (!installments.length) throw new Error('The saved plan has no amount to collect.');
    const ledger: PaymentLedger = { _id: orderId, orderId, ruleId: rule.id, currency, totalOrderAmount, installments };
    try {
      await items.insert(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(ledger));
    } catch {
      const createdByAnotherRequest = await getPaymentLedger(orderId);
      if (createdByAnotherRequest) return startedPlan(createdByAnotherRequest);
      throw new Error('DepositCraft could not create the order payment ledger.');
    }
    await syncInstallmentAutomations(ledger);
    return startedPlan(await createNextRequest(ledger));
  });
}

/** Creates the next unpaid installment link when the previous one is already marked paid in the ledger. */
export async function advancePaymentPlanForOrder(orderId: string): Promise<StartedPaymentPlan | undefined> {
  if (!orderId) throw new Error('An existing Wix order ID is required.');
  return withOrderLock(orderId, async () => {
    const ledger = await getPaymentLedger(orderId);
    if (!ledger) throw new Error('No DepositCraft payment plan exists for this order yet.');
    const updated = await createNextRequest(ledger);
    const pending = updated.installments.find(item => item.paymentRequestUrl && item.status !== 'PAID');
    return pending?.paymentRequestUrl ? startedPlan(updated) : undefined;
  });
}

/** Reconcile ledger installment status with Wix payment-request status, then queue the next link when needed. */
export async function syncPaymentPlanFromWix(orderId: string): Promise<PaymentLedger | undefined> {
  if (!orderId) throw new Error('An existing Wix order ID is required.');
  return withOrderLock(orderId, async () => {
    let ledger = await getPaymentLedger(orderId);
    if (!ledger) return undefined;
    let changed = false;
    for (const installment of ledger.installments) {
      if (!installment.paymentRequestId || installment.status === 'PAID') continue;
      const request = await orderPaymentRequests.getOrderPaymentRequest(installment.paymentRequestId);
      if (request.status !== 'PAID') continue;
      ledger = {
        ...ledger,
        installments: ledger.installments.map(item => (
          item.installmentNumber === installment.installmentNumber ? { ...item, status: 'PAID' as const } : item
        )),
      };
      changed = true;
    }
    if (changed) {
      await items.save(PAYMENT_LEDGER_COLLECTION, toLedgerRecord(ledger));
      await syncInstallmentAutomations(ledger);
      ledger = await createNextRequest(ledger);
    }
    return ledger;
  });
}
