import { FormattedMessage } from 'react-intl';
import React, { useEffect, useState } from 'react';
import type { plugins } from '@wix/ecom/dashboard';
import { orders } from '@wix/ecom';
import { Box, Button, Card, Divider, Dropdown, SkeletonGroup, SkeletonLine, Text, TextButton, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { loadConfiguration } from '../../../shared/configuration';
import { emitDiagnostic } from '../../../shared/logger';
import type { LedgerInstallment, PaymentLedger } from '../../../shared/payment-ledger';
import { getPaymentLedger } from '../../../shared/payment-ledger';
import { advancePaymentPlanForOrder, startPaymentPlanForOrder, syncPaymentPlanFromWix } from '../../../shared/payment-plan-service';
import { showAppToast } from '../../../shared/toast';
import type { DepositRule } from '../../../types';
function installmentStatusLabel(item: LedgerInstallment): string {
  if (item.status === 'PAID') return 'Paid';
  if (item.status === 'CREATING') return 'Creating link…';
  if (item.paymentRequestUrl) return 'Awaiting payment';
  return 'Queued';
}
function activePaymentUrl(ledger: PaymentLedger | undefined): string {
  const activeRequest = ledger?.installments.find(item => item.paymentRequestUrl && item.status !== 'PAID');
  return activeRequest?.paymentRequestUrl ?? '';
}
function canAdvancePlan(ledger: PaymentLedger | undefined): boolean {
  if (!ledger) return false;
  const hasOpenRequest = ledger.installments.some(item => item.paymentRequestUrl && item.status !== 'PAID');
  if (hasOpenRequest) return false;
  return ledger.installments.some(item => item.status === 'PENDING' && !item.paymentRequestId);
}
export default function DepositCraftOrderDetails({
  orderId
}: plugins.OrderDetails.OrderDetailsSecondaryCardProps) {
  const [rules, setRules] = useState<DepositRule[]>([]);
  const [ruleId, setRuleId] = useState<string | undefined>();
  const [summary, setSummary] = useState('');
  const [ledger, setLedger] = useState<PaymentLedger | undefined>();
  const [paymentUrl, setPaymentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const applyLedger = (updated: PaymentLedger | undefined) => {
    setLedger(updated);
    setPaymentUrl(activePaymentUrl(updated));
  };
  useEffect(() => {
    let active = true;
    if (!orderId) return;
    setIsLoading(true);
    const start = Date.now();
    Promise.all([orders.getOrder(orderId), loadConfiguration<DepositRule>(), getPaymentLedger(orderId).catch(() => undefined)]).then(([order, savedRules, existingLedger]) => {
      if (!active) return;
      const enabled = savedRules.filter(rule => rule.enabled);
      setRules(enabled);
      setRuleId(existingLedger?.ruleId ?? enabled[0]?.id);
      const amount = order.priceSummary?.total?.formattedAmount ?? order.priceSummary?.total?.amount;
      setSummary(amount && order.currency ? `Verified order total: ${amount} ${order.currency}.` : 'This order does not have a payable total yet.');
      applyLedger(existingLedger);
      emitDiagnostic('order_load', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    }).catch(() => {
      if (active) {
        setSummary('We could not load this order’s DepositCraft plans right now.');
        emitDiagnostic('order_load', {
          outcome: 'failure',
          surface: 'order_slot',
          durationMs: Date.now() - start,
          errorCode: 'ORDER_LOAD_FAILED'
        });
      }
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [orderId]);
  const handleStartPaymentPlan = async () => {
    if (!orderId || !ruleId) return;
    setIsStarting(true);
    const start = Date.now();
    try {
      const result = await startPaymentPlanForOrder(orderId, ruleId);
      setPaymentUrl(result.paymentRequestUrl);
      applyLedger(await getPaymentLedger(orderId));
      showAppToast('Payment request created. Share the link with your customer.', 'success');
      emitDiagnostic('payment_request_start', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'DepositCraft could not create a payment request.';
      showAppToast(message, 'error');
      emitDiagnostic('payment_request_start', {
        outcome: 'failure',
        surface: 'order_slot',
        durationMs: Date.now() - start,
        errorCode: 'PAYMENT_REQUEST_FAILED'
      });
    } finally {
      setIsStarting(false);
    }
  };
  const handleRefreshStatus = async () => {
    if (!orderId) return;
    setIsSyncing(true);
    const start = Date.now();
    try {
      const updated = await syncPaymentPlanFromWix(orderId);
      if (!updated) {
        showAppToast('No DepositCraft payment plan exists for this order yet.', 'error');
        return;
      }
      applyLedger(updated);
      const paidNow = updated.installments.filter(item => item.status === 'PAID').length;
      showAppToast(`Payment status refreshed (${paidNow} of ${updated.installments.length} collected).`, 'success');
      emitDiagnostic('payment_request_sync', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'DepositCraft could not refresh payment status.';
      showAppToast(message, 'error');
      emitDiagnostic('payment_request_sync', {
        outcome: 'failure',
        surface: 'order_slot',
        durationMs: Date.now() - start,
        errorCode: 'PAYMENT_SYNC_FAILED'
      });
    } finally {
      setIsSyncing(false);
    }
  };
  const handleAdvancePlan = async () => {
    if (!orderId) return;
    setIsAdvancing(true);
    const start = Date.now();
    try {
      const result = await advancePaymentPlanForOrder(orderId);
      if (!result) {
        showAppToast('All scheduled payments are collected or already have an open payment link.', 'success');
        applyLedger(await getPaymentLedger(orderId));
        return;
      }
      setPaymentUrl(result.paymentRequestUrl);
      applyLedger(await getPaymentLedger(orderId));
      showAppToast('Next payment link created.', 'success');
      emitDiagnostic('payment_request_advance', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'DepositCraft could not create the next payment link.';
      showAppToast(message, 'error');
      emitDiagnostic('payment_request_advance', {
        outcome: 'failure',
        surface: 'order_slot',
        durationMs: Date.now() - start,
        errorCode: 'PAYMENT_ADVANCE_FAILED'
      });
    } finally {
      setIsAdvancing(false);
    }
  };
  const paidCount = ledger?.installments.filter(item => item.status === 'PAID').length ?? 0;
  const totalInstallments = ledger?.installments.length ?? 0;
  const allPaid = Boolean(ledger && paidCount === totalInstallments && totalInstallments > 0);
  return <WixDesignSystemProvider>
      <Card>
        <Card.Header title={<FormattedMessage id="depositcraft.depositcraft-payment-plan" defaultMessage="DepositCraft payment plan" />} />
        <Card.Content>
          {isLoading ? <SkeletonGroup skin="light">
              <SkeletonLine width="80%" marginBottom="12px" />
              <SkeletonLine width="100%" marginBottom="12px" />
              <SkeletonLine width="60%" />
            </SkeletonGroup> : <Box direction="vertical" gap="SP2">
              <Text>{summary}</Text>
              {rules.length > 0 ? <Dropdown placeholder="Choose a saved deposit plan" selectedId={ruleId} onSelect={option => setRuleId(String(option.id))} options={rules.map(rule => ({
            id: rule.id,
            value: rule.name
          }))} disabled={Boolean(ledger)} /> : <Text size="small" secondary><FormattedMessage id="depositcraft.no-active-deposit-plans-are-saved-yet-ad" defaultMessage="No active deposit plans are saved yet. Add one from the DepositCraft dashboard page." /></Text>}
              {ledger && <>
                  <Text size="small" secondary>
                    {allPaid ? 'All scheduled payments are collected for this order.' : `${paidCount} of ${totalInstallments} scheduled payments collected. DepositCraft creates the next payment link after Wix marks the previous request paid.`}
                  </Text>
                  <Divider />
                  <Box direction="vertical" gap="SP1">
                    <Text size="small" weight="bold"><FormattedMessage id="depositcraft.installment-schedule" defaultMessage="Installment schedule" /></Text>
                    {ledger.installments.map(item => <Box key={item.installmentNumber} align="space-between" verticalAlign="middle">
                        <Box direction="vertical">
                          <Text size="small" weight="bold">
                            {item.installmentNumber === 0 ? 'Deposit' : `Installment ${item.installmentNumber}`}
                          </Text>
                          <Text size="tiny" secondary>{installmentStatusLabel(item)}</Text>
                        </Box>
                        <Text size="small" weight="bold">{item.amount.toFixed(2)} {ledger.currency}</Text>
                      </Box>)}
                  </Box>
                </>}
              <Box gap="SP2">
                <Button priority="primary" onClick={() => {
              if (paymentUrl) {
                window.open(paymentUrl, '_blank', 'noopener');
                return;
              }
              void handleStartPaymentPlan();
            }} disabled={!ruleId || !rules.length || isStarting || allPaid}>
                  {paymentUrl ? 'Open payment link' : 'Create payment request'}
                </Button>
                {ledger && <>
                    <Button priority="secondary" onClick={() => void handleRefreshStatus()} disabled={isSyncing}>
                      <FormattedMessage id="depositcraft.refresh-payment-status" defaultMessage="Refresh payment status" />
                    </Button>
                    {canAdvancePlan(ledger) && <Button priority="secondary" onClick={() => void handleAdvancePlan()} disabled={isAdvancing}>
                        <FormattedMessage id="depositcraft.create-next-payment-link" defaultMessage="Create next payment link" />
                      </Button>}
                  </>}
              </Box>
              {paymentUrl && <Box direction="vertical" gap="SP1">
                  <Text size="small" weight="bold"><FormattedMessage id="depositcraft.customer-payment-link" defaultMessage="Customer payment link" /></Text>
                  <TextButton as="a" href={paymentUrl} target="_blank" rel="noopener noreferrer">
                    <FormattedMessage id="depositcraft.open-payment-page" defaultMessage="Open payment page" />
                  </TextButton>
                  <Text size="tiny" secondary>
                    Your site needs a published Payment Request Page. Customers pay manually through this link. DepositCraft does not auto-charge saved cards or send email on its own — use Automations (Installment due reminder) for scheduled reminders.
                  </Text>
                </Box>}
            </Box>}
        </Card.Content>
      </Card>
    </WixDesignSystemProvider>;
}