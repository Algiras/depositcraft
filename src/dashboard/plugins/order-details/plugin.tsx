import { FormattedMessage, useIntl, type IntlShape } from 'react-intl';
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
import { withIntlProvider } from '../../../intl/withIntlProvider';

function installmentStatusLabel(intl: IntlShape, item: LedgerInstallment): string {
  if (item.status === 'PAID') return intl.formatMessage({
    id: 'app.order.statusPaid',
    defaultMessage: 'Paid'
  });
  if (item.status === 'CREATING') return intl.formatMessage({
    id: 'app.order.statusCreating',
    defaultMessage: 'Creating link…'
  });
  if (item.paymentRequestUrl) return intl.formatMessage({
    id: 'app.order.statusAwaitingPayment',
    defaultMessage: 'Awaiting payment'
  });
  return intl.formatMessage({
    id: 'app.order.statusQueued',
    defaultMessage: 'Queued'
  });
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
function DepositCraftOrderDetails({
  orderId
}: plugins.OrderDetails.OrderDetailsSecondaryCardProps) {
  const intl = useIntl();
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
      setSummary(amount && order.currency ? intl.formatMessage({
        id: 'app.order.orderTotalVerified',
        defaultMessage: 'Verified order total: {amount} {currency}.'
      }, {
        amount,
        currency: order.currency
      }) : intl.formatMessage({
        id: 'app.order.orderTotalMissing',
        defaultMessage: 'This order does not have a payable total yet.'
      }));
      applyLedger(existingLedger);
      emitDiagnostic('order_load', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    }).catch(() => {
      if (active) {
        setSummary(intl.formatMessage({
          id: 'app.order.loadFailed',
          defaultMessage: 'We could not load this order’s DepositCraft plans right now.'
        }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  const handleStartPaymentPlan = async () => {
    if (!orderId || !ruleId) return;
    setIsStarting(true);
    const start = Date.now();
    try {
      const result = await startPaymentPlanForOrder(orderId, ruleId);
      setPaymentUrl(result.paymentRequestUrl);
      applyLedger(await getPaymentLedger(orderId));
      showAppToast(intl.formatMessage({
        id: 'app.order.paymentRequestCreatedToast',
        defaultMessage: 'Payment request created. Share the link with your customer.'
      }), 'success');
      emitDiagnostic('payment_request_start', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    } catch {
      showAppToast(intl.formatMessage({
        id: 'app.order.paymentRequestFailedToast',
        defaultMessage: 'DepositCraft could not create a payment request.'
      }), 'error');
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
        showAppToast(intl.formatMessage({
          id: 'app.order.noPaymentPlanToast',
          defaultMessage: 'No DepositCraft payment plan exists for this order yet.'
        }), 'error');
        return;
      }
      applyLedger(updated);
      const paidNow = updated.installments.filter(item => item.status === 'PAID').length;
      showAppToast(intl.formatMessage({
        id: 'app.order.paymentStatusRefreshedToast',
        defaultMessage: 'Payment status refreshed ({paidCount} of {totalInstallments} collected).'
      }, {
        paidCount: paidNow,
        totalInstallments: updated.installments.length
      }), 'success');
      emitDiagnostic('payment_request_sync', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    } catch {
      showAppToast(intl.formatMessage({
        id: 'app.order.paymentSyncFailedToast',
        defaultMessage: 'DepositCraft could not refresh payment status.'
      }), 'error');
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
        showAppToast(intl.formatMessage({
          id: 'app.order.allCollectedOrOpenToast',
          defaultMessage: 'All scheduled payments are collected or already have an open payment link.'
        }), 'success');
        applyLedger(await getPaymentLedger(orderId));
        return;
      }
      setPaymentUrl(result.paymentRequestUrl);
      applyLedger(await getPaymentLedger(orderId));
      showAppToast(intl.formatMessage({
        id: 'app.order.nextLinkCreatedToast',
        defaultMessage: 'Next payment link created.'
      }), 'success');
      emitDiagnostic('payment_request_advance', {
        outcome: 'success',
        surface: 'order_slot',
        durationMs: Date.now() - start
      });
    } catch {
      showAppToast(intl.formatMessage({
        id: 'app.order.paymentAdvanceFailedToast',
        defaultMessage: 'DepositCraft could not create the next payment link.'
      }), 'error');
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
        <Card.Header title={intl.formatMessage({
        id: 'app.order.cardTitle',
        defaultMessage: 'DepositCraft payment plan'
      })} />
        <Card.Content>
          {isLoading ? <SkeletonGroup skin="light">
              <SkeletonLine width="80%" marginBottom="12px" />
              <SkeletonLine width="100%" marginBottom="12px" />
              <SkeletonLine width="60%" />
            </SkeletonGroup> : <Box direction="vertical" gap="SP2">
              <Text>{summary}</Text>
              {rules.length > 0 ? <Dropdown placeholder={intl.formatMessage({
            id: 'app.order.choosePlanPlaceholder',
            defaultMessage: 'Choose a saved deposit plan'
          })} selectedId={ruleId} onSelect={option => setRuleId(String(option.id))} options={rules.map(rule => ({
            id: rule.id,
            value: rule.name
          }))} disabled={Boolean(ledger)} /> : <Text size="small" secondary><FormattedMessage id="app.order.noActivePlans" defaultMessage="No active deposit plans are saved yet. Add one from the DepositCraft dashboard page." /></Text>}
              {ledger && <>
                  <Text size="small" secondary>
                    {allPaid ? <FormattedMessage id="app.order.allPaid" defaultMessage="All scheduled payments are collected for this order." /> : <FormattedMessage id="app.order.partiallyPaid" defaultMessage="{paidCount} of {totalInstallments} scheduled payments collected. DepositCraft creates the next payment link after Wix marks the previous request paid." values={{
                  paidCount,
                  totalInstallments
                }} />}
                  </Text>
                  <Divider />
                  <Box direction="vertical" gap="SP1">
                    <Text size="small" weight="bold"><FormattedMessage id="app.order.installmentScheduleTitle" defaultMessage="Installment schedule" /></Text>
                    {ledger.installments.map(item => <Box key={item.installmentNumber} align="space-between" verticalAlign="middle">
                        <Box direction="vertical">
                          <Text size="small" weight="bold">
                            {item.installmentNumber === 0 ? <FormattedMessage id="app.order.depositLineLabel" defaultMessage="Deposit" /> : <FormattedMessage id="app.order.installmentLineLabel" defaultMessage="Installment {number}" values={{
                          number: item.installmentNumber
                        }} />}
                          </Text>
                          <Text size="tiny" secondary>{installmentStatusLabel(intl, item)}</Text>
                        </Box>
                        <Text size="small" weight="bold">{intl.formatNumber(item.amount, {
                      style: 'currency',
                      currency: ledger.currency
                    })}</Text>
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
                  {paymentUrl ? <FormattedMessage id="app.order.openPaymentLinkButton" defaultMessage="Open payment link" /> : <FormattedMessage id="app.order.createPaymentRequestButton" defaultMessage="Create payment request" />}
                </Button>
                {ledger && <>
                    <Button priority="secondary" onClick={() => void handleRefreshStatus()} disabled={isSyncing}>
                      <FormattedMessage id="app.order.refreshPaymentStatusButton" defaultMessage="Refresh payment status" />
                    </Button>
                    {canAdvancePlan(ledger) && <Button priority="secondary" onClick={() => void handleAdvancePlan()} disabled={isAdvancing}>
                        <FormattedMessage id="app.order.createNextPaymentLinkButton" defaultMessage="Create next payment link" />
                      </Button>}
                  </>}
              </Box>
              {paymentUrl && <Box direction="vertical" gap="SP1">
                  <Text size="small" weight="bold"><FormattedMessage id="app.order.customerPaymentLinkTitle" defaultMessage="Customer payment link" /></Text>
                  <TextButton as="a" href={paymentUrl} target="_blank" rel="noopener noreferrer">
                    <FormattedMessage id="app.order.openPaymentPageButton" defaultMessage="Open payment page" />
                  </TextButton>
                  <Text size="tiny" secondary>
                    <FormattedMessage id="app.order.paymentLinkFootnote" defaultMessage="Your site needs a published Payment Request Page. Customers pay manually through this link. DepositCraft does not auto-charge saved cards or send email on its own — use Automations (Installment due reminder) for scheduled reminders." />
                  </Text>
                </Box>}
            </Box>}
        </Card.Content>
      </Card>
    </WixDesignSystemProvider>;
}
export default withIntlProvider(DepositCraftOrderDetails);
