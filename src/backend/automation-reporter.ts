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

async function orderContactId(orderId: string): Promise<string | undefined> {
  try {
    const order = await auth.elevate(orders.getOrder)(orderId);
    return order.buyerInfo?.contactId ?? undefined;
  } catch {
    return undefined;
  }
}

export async function reportInstallmentDueAutomation(
  ledger: PaymentLedger,
  installmentNumber: number,
  paymentRequestUrl: string,
): Promise<void> {
  const installment = ledger.installments.find(item => item.installmentNumber === installmentNumber);
  if (!installment?.dueAt) return;
  const contactId = await orderContactId(ledger.orderId);
  if (!contactId) {
    emitDiagnostic('automation_report', {
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
    await auth.elevate(activations.reportEvent)(INSTALLMENT_DUE_TRIGGER_KEY, {
      payload,
      externalEntityId: installmentAutomationExternalEntityId(ledger.orderId, installmentNumber),
      idempotency: { key: installmentAutomationIdempotencyKey(ledger.orderId, installmentNumber) },
    });
    emitDiagnostic('automation_report', { outcome: 'success', surface: 'backend', durationMs: Date.now() - start });
  } catch (error) {
    emitDiagnostic('automation_report', {
      outcome: 'failure',
      surface: 'backend',
      durationMs: Date.now() - start,
      errorCode: 'AUTOMATION_REPORT_FAILED',
    });
    console.error('DepositCraft automation report failed', error);
  }
}

export async function cancelInstallmentDueAutomation(orderId: string, installmentNumber: number): Promise<void> {
  try {
    await auth.elevate(activations.cancelEvent)(
      INSTALLMENT_DUE_TRIGGER_KEY,
      installmentAutomationExternalEntityId(orderId, installmentNumber),
    );
    emitDiagnostic('automation_cancel', { outcome: 'success', surface: 'backend' });
  } catch {
    emitDiagnostic('automation_cancel', { outcome: 'failure', surface: 'backend', errorCode: 'AUTOMATION_CANCEL_FAILED' });
  }
}

export async function syncInstallmentAutomations(ledger: PaymentLedger): Promise<void> {
  for (const installment of ledger.installments) {
    if (installment.status === 'PAID') {
      await cancelInstallmentDueAutomation(ledger.orderId, installment.installmentNumber);
      continue;
    }
    if (installment.dueAt) {
      await reportInstallmentDueAutomation(ledger, installment.installmentNumber, installment.paymentRequestUrl ?? '');
    }
  }
}
