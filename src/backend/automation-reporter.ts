import { activations } from '@wix/automations';
import { orders } from '@wix/ecom';
import { auth } from '@wix/essentials';
import {
  INSTALLMENT_DUE_TRIGGER_KEY,
  installmentAutomationExternalEntityId,
  installmentAutomationIdempotencyKey,
  type InstallmentAutomationPayload,
} from '../shared/automation-triggers';
import { emitDiagnostic } from '../shared/logger';
import type { PaymentLedger } from '../shared/payment-ledger';

/**
 * This module is reached from BOTH genuine backend code (event handlers,
 * `payment-request-lifecycle.ts`, `checkout-order-lifecycle.ts` -- no
 * merchant session) AND the dashboard, via
 * `src/shared/payment-plan-service.ts`'s `startPaymentPlanForOrder` /
 * `advancePaymentPlanForOrder` / `syncPaymentPlanFromWix` (merchant actions
 * driven from `src/dashboard/plugins/order-details/plugin.tsx`). Every
 * `orders`/`activations` call here is therefore parameterized on an
 * `elevated` option, defaulting to NOT elevated (merchant session), matching
 * the reader/option pattern in
 * `05-volume-tiered-pricing/discountcraft/src/shared/configuration.ts`.
 * Genuine backend callers pass `{ elevated: true }` explicitly.
 *
 * The diagnostics emitter is a separate, similarly-injectable axis: this
 * module imports only the PLAIN, dashboard-safe `emitDiagnostic` (never the
 * unconditionally-elevated `emitBackendDiagnostic` -- importing that here
 * would itself make this module unsafe for the dashboard, regardless of how
 * carefully the import were gated behind a flag). Callers that want elevated
 * diagnostics inject their own already-imported `emitBackendDiagnostic`
 * explicitly, the same way genuine backend files in this app already do for
 * their own events.
 */
export interface AutomationReportOptions {
  elevated?: boolean;
}

type DiagnosticEmitter = typeof emitDiagnostic;

async function orderContactId(orderId: string, options: AutomationReportOptions = {}): Promise<string | undefined> {
  try {
    const getOrder = options.elevated ? auth.elevate(orders.getOrder) : orders.getOrder;
    const order = await getOrder(orderId);
    return order.buyerInfo?.contactId ?? undefined;
  } catch {
    return undefined;
  }
}

export async function reportInstallmentDueAutomation(
  ledger: PaymentLedger,
  installmentNumber: number,
  paymentRequestUrl: string,
  options: AutomationReportOptions = {},
  emit: DiagnosticEmitter = emitDiagnostic,
): Promise<void> {
  const installment = ledger.installments.find(item => item.installmentNumber === installmentNumber);
  if (!installment?.dueAt) return;
  const contactId = await orderContactId(ledger.orderId, options);
  if (!contactId) {
    emit('automation_report', {
      outcome: 'failure',
      surface: 'backend',
      errorCode: 'MISSING_CONTACT_ID',
    });
    return;
  }
  const payload: InstallmentAutomationPayload = {
    contactId,
    orderId: ledger.orderId,
    installmentNumber,
    amount: installment.amount,
    currency: ledger.currency,
    dueAt: installment.dueAt,
    ...(paymentRequestUrl ? { paymentRequestUrl } : {}),
  };
  const start = Date.now();
  try {
    const reportEvent = options.elevated ? auth.elevate(activations.reportEvent) : activations.reportEvent;
    await reportEvent(INSTALLMENT_DUE_TRIGGER_KEY, {
      payload,
      externalEntityId: installmentAutomationExternalEntityId(ledger.orderId, installmentNumber),
      idempotency: { key: installmentAutomationIdempotencyKey(ledger.orderId, installmentNumber) },
    });
    emit('automation_report', { outcome: 'success', surface: 'backend', durationMs: Date.now() - start });
  } catch (error) {
    emit('automation_report', {
      outcome: 'failure',
      surface: 'backend',
      durationMs: Date.now() - start,
      errorCode: 'AUTOMATION_REPORT_FAILED',
    });
    console.error('DepositCraft automation report failed', error);
  }
}

export async function cancelInstallmentDueAutomation(
  orderId: string,
  installmentNumber: number,
  options: AutomationReportOptions = {},
  emit: DiagnosticEmitter = emitDiagnostic,
): Promise<void> {
  try {
    const cancelEvent = options.elevated ? auth.elevate(activations.cancelEvent) : activations.cancelEvent;
    await cancelEvent(
      INSTALLMENT_DUE_TRIGGER_KEY,
      installmentAutomationExternalEntityId(orderId, installmentNumber),
    );
    emit('automation_cancel', { outcome: 'success', surface: 'backend' });
  } catch {
    emit('automation_cancel', { outcome: 'failure', surface: 'backend', errorCode: 'AUTOMATION_CANCEL_FAILED' });
  }
}

export async function syncInstallmentAutomations(
  ledger: PaymentLedger,
  options: AutomationReportOptions = {},
  emit: DiagnosticEmitter = emitDiagnostic,
): Promise<void> {
  for (const installment of ledger.installments) {
    if (installment.status === 'PAID') {
      await cancelInstallmentDueAutomation(ledger.orderId, installment.installmentNumber, options, emit);
      continue;
    }
    if (installment.dueAt) {
      await reportInstallmentDueAutomation(ledger, installment.installmentNumber, installment.paymentRequestUrl ?? '', options, emit);
    }
  }
}
