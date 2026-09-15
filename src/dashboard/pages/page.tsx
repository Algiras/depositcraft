import { withIntlProvider } from '../../intl/withIntlProvider';
import { FormattedMessage } from 'react-intl';
import React, { useEffect, useRef, useState } from 'react';
import { appInstances } from '@wix/app-management';
import { WixDesignSystemProvider, Page, Card, Table, TableActionCell, Button, TextButton, Badge, ToggleSwitch, Input, NumberInput, FormField, Modal, CustomModalLayout, MessageModalLayout, Box, Heading, Text, Divider, EmptyState, SectionHelper, StatisticsWidget, RadioGroup, Dropdown, Loader, Tooltip, InfoIcon } from '@wix/design-system';
import { Delete } from '@wix/wix-ui-icons-common';
import '@wix/design-system/styles.global.css';
import { loadConfiguration, saveConfiguration, assessConfigurationStorage } from '../../shared/configuration';
import { classifyStorageFailure, confirmStorageWithAutoRetry, extractRequestId, storageDetailHint, type StorageSetupState } from '../../shared/storage-readiness';
import { emitDiagnostic, markDashboardLoaded, markSetupFinished } from '../../shared/logger';
import { showAppToast } from '../../shared/toast';
import { getAppEntitlement, canUsePaidFeatures, getWixPricingPageUrl, AppEntitlement } from '../../shared/entitlement';
import { evaluateRuleAgainstPlan, canUseFixedDeposit, canUseCustomFrequency, FREE_PLAN_MAX_ACTIVE_RULES, FREE_PLAN_FIXED_FREQUENCY } from '../../shared/plan-limits';
import { DepositRule, DepositType, DepositRuleScope, InstallmentFrequency } from '../../types';
import { evaluateDepositPlan } from '../../backend/deposit-engine';
import { resolveEcommerceInstalled, WIX_STORES_APP_MARKET_URL, type EcommerceInstallState } from '../../shared/ecommerce';
import { deferredDiscountPercent } from '../../shared/cart-evaluation';
import { depositTriggerName } from '../../shared/deposit-trigger-id';
import { processDueInstallments } from '../../shared/installment-billing';
const APP_ID = 'cecd3584-c6bd-4895-a776-613643ef171d';
const SUPPORT_EMAIL = 'kras.algim@gmail.com';
class ErrorBoundary extends React.Component<{
  children: React.ReactNode;
}, {
  hasError: boolean;
  error: string;
}> {
  constructor(props: {
    children: React.ReactNode;
  }) {
    super(props);
    this.state = {
      hasError: false,
      error: ''
    };
  }
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      error: error.message
    };
  }
  componentDidCatch(_error: Error) {
    emitDiagnostic('dashboard_error', {
      outcome: 'failure',
      errorCode: 'RENDER_FAILED'
    });
  }
  render() {
    if (this.state.hasError) {
      return <Page>
          <Page.Content>
            <Card>
              <Card.Content>
                <Box direction="vertical" gap="12px">
                  <Heading size="small"><FormattedMessage id="depositcraft.something-went-wrong-loading-the-dashboa" defaultMessage="Something went wrong loading the dashboard." /></Heading>
                  <Text size="small" secondary>{this.state.error || 'Reload this page or contact support if the problem continues.'}</Text>
                  <Box>
                    <Button onClick={() => this.setState({
                    hasError: false,
                    error: ''
                  })}><FormattedMessage id="depositcraft.try-again" defaultMessage="Try again" /></Button>
                  </Box>
                </Box>
              </Card.Content>
            </Card>
          </Page.Content>
        </Page>;
    }
    return this.props.children;
  }
}
function supportMailtoUrl(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
function ContactSupportLink({
  subject
}: {
  subject: string;
}) {
  return <TextButton size="small" as="a" href={supportMailtoUrl(subject)}>
      <FormattedMessage id="depositcraft.contact-support" defaultMessage="Contact support" />
    </TextButton>;
}
const FREQUENCY_OPTIONS: {
  id: InstallmentFrequency;
  value: string;
}[] = [{
  id: 'WEEKLY',
  value: 'Weekly'
}, {
  id: 'BIWEEKLY',
  value: 'Every 2 weeks'
}, {
  id: 'MONTHLY',
  value: 'Monthly'
}];
function DepositCraftDashboard() {
  const [rules, setRules] = useState<DepositRule[]>([]);
  const [storageStatus, setStorageStatus] = useState('');
  const [storageDetail, setStorageDetail] = useState('');
  const [storageState, setStorageState] = useState<StorageSetupState | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [instanceId, setInstanceId] = useState('');
  const [ecommerceInstalled, setEcommerceInstalled] = useState<EcommerceInstallState>(undefined);
  const [entitlement, setEntitlement] = useState<AppEntitlement>({
    status: 'unavailable'
  });
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);
  const [isBillingRun, setIsBillingRun] = useState(false);
  const wasPaidRef = useRef(false);
  const reloadStorage = async (autoRetry = false) => {
    const start = Date.now();
    try {
      setStorageStatus('Checking whether your storage is set up…');
      setStorageDetail('');
      const readiness = autoRetry ? await confirmStorageWithAutoRetry(() => assessConfigurationStorage()) : await assessConfigurationStorage();
      setStorageState(readiness.state);
      if (!readiness.ready) {
        emitDiagnostic('storage_verify', {
          outcome: 'failure',
          durationMs: Date.now() - start,
          errorCode: readiness.state.toUpperCase(),
          wixRequestId: readiness.requestId,
          surface: 'dashboard'
        });
        setStorageReady(false);
        setStorageStatus(readiness.message);
        setStorageDetail(readiness.details || storageDetailHint(readiness.state, readiness.requestId));
        return;
      }
      const saved = await loadConfiguration<DepositRule>();
      setRules(saved);
      setStorageReady(true);
      setStorageStatus('');
      setStorageDetail('');
      setStorageState('ready');
      markSetupFinished();
      emitDiagnostic('storage_verify', {
        outcome: 'success',
        durationMs: Date.now() - start,
        surface: 'dashboard'
      });
    } catch (error) {
      const classified = classifyStorageFailure(error, 'DepositCraft');
      setStorageState('error');
      emitDiagnostic('storage_verify', {
        outcome: 'failure',
        durationMs: Date.now() - start,
        errorCode: classified.state.toUpperCase(),
        wixRequestId: classified.requestId ?? extractRequestId(error),
        surface: 'dashboard'
      });
      setStorageReady(false);
      setStorageStatus('We could not check your storage setup.');
      setStorageDetail(storageDetailHint(classified.state, classified.requestId ?? extractRequestId(error)));
    }
  };
  const refreshEntitlement = () => {
    void getAppEntitlement().then(value => {
      const isPaidNow = canUsePaidFeatures(value);
      if (isPaidNow && !wasPaidRef.current) {
        setShowUpgradeSuccess(true);
        showAppToast('Pro plan active. Unlimited plans and custom schedules are unlocked.', 'success');
      }
      wasPaidRef.current = isPaidNow;
      setEntitlement(value);
      emitDiagnostic('entitlement_check', {
        outcome: value.status === 'unavailable' ? 'failure' : 'success'
      });
    });
  };
  useEffect(() => {
    markDashboardLoaded();
    (async () => {
      await Promise.all([reloadStorage(false), Promise.resolve(refreshEntitlement())]);
      setIsInitialLoading(false);
    })();
    void appInstances.getAppInstance().then(({
      instance,
      site
    }: any) => {
      if (instance?.instanceId) setInstanceId(instance.instanceId);
      setEcommerceInstalled(resolveEcommerceInstalled(site?.installedWixApps));
    }).catch(() => setEcommerceInstalled(undefined));
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshEntitlement();
    };
    window.addEventListener('focus', refreshEntitlement);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refreshEntitlement);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isPaidPlan = canUsePaidFeatures(entitlement);
  const upgradeUrl = instanceId ? getWixPricingPageUrl(APP_ID, instanceId) : undefined;
  const saveChanges = async () => {
    try {
      await saveConfiguration(rules);
      showAppToast('Configuration saved.', 'success');
      emitDiagnostic('plan_save', {
        outcome: 'success'
      });
    } catch (error) {
      showAppToast('Your changes were not saved. Please try again.', 'error');
      emitDiagnostic('plan_save', {
        outcome: 'failure',
        errorCode: 'SAVE_FAILED'
      });
    }
  };
  const handleUpgrade = () => {
    if (!upgradeUrl || typeof window === 'undefined') return;
    window.open(upgradeUrl, '_blank', 'noopener');
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [ruleIdPendingDelete, setRuleIdPendingDelete] = useState<string | null>(null);

  // Modal form state
  const [newRuleName, setNewRuleName] = useState('');
  const [newDepositType, setNewDepositType] = useState<DepositType>('PERCENTAGE');
  const [newDepositValue, setNewDepositValue] = useState('25');
  const [newInstallments, setNewInstallments] = useState('4');
  const [newFrequency, setNewFrequency] = useState<InstallmentFrequency>('BIWEEKLY');
  const [newMinSubtotal, setNewMinSubtotal] = useState('250');
  const [newScope, setNewScope] = useState<DepositRuleScope>('ALL_PRODUCTS');
  const [newTargetCollections, setNewTargetCollections] = useState('');
  const [modalGateMessage, setModalGateMessage] = useState('');

  // Simulator state
  const [simSubtotal, setSimSubtotal] = useState('1200.00');
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const activeCount = rules.filter(r => r.enabled).length;
  const toggleRule = (id: string) => {
    const target = rules.find(r => r.id === id);
    if (!target) return;
    if (!target.enabled) {
      const gate = evaluateRuleAgainstPlan(target, entitlement, activeCount);
      if (!gate.allowed) {
        showAppToast(gate.message || 'This plan needs the Pro plan.', 'error');
        return;
      }
    }
    setRules(prev => prev.map(r => r.id === id ? {
      ...r,
      enabled: !r.enabled
    } : r));
    emitDiagnostic('plan_toggle', {
      outcome: 'success'
    });
  };
  const resetModalForm = () => {
    setNewRuleName('');
    setNewDepositType('PERCENTAGE');
    setNewDepositValue('25');
    setNewInstallments('4');
    setNewFrequency('BIWEEKLY');
    setNewMinSubtotal('250');
    setNewScope('ALL_PRODUCTS');
    setNewTargetCollections('');
    setModalGateMessage('');
  };
  const handleAddRule = () => {
    if (!newRuleName.trim()) return;
    const candidate = {
      depositType: newDepositType,
      installmentFrequency: newFrequency,
      enabled: true
    };
    const gate = evaluateRuleAgainstPlan(candidate, entitlement, activeCount);
    if (!gate.allowed) {
      setModalGateMessage(gate.message || 'This plan is not available on your current plan.');
      return;
    }
    const newRule: DepositRule = {
      id: `rule-${Date.now()}`,
      name: newRuleName.trim(),
      depositType: newDepositType,
      depositValue: parseFloat(newDepositValue) || 20,
      layawayInstallments: parseInt(newInstallments, 10) || 3,
      installmentFrequency: newFrequency,
      minOrderSubtotal: parseFloat(newMinSubtotal) || 0,
      scope: newScope,
      targetCollectionIds: newScope === 'COLLECTION' && newTargetCollections ? newTargetCollections.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      enabled: true,
      description: `${newDepositValue}${newDepositType === 'PERCENTAGE' ? '%' : '$'} deposit with ${newInstallments} installments`,
      createdAt: new Date().toISOString()
    };
    setRules(prev => [newRule, ...prev]);
    setIsModalOpen(false);
    resetModalForm();
    showAppToast('Plan created. Click "Save configuration" to keep it.', 'success');
    emitDiagnostic('plan_create', {
      outcome: 'success'
    });
  };
  const confirmDeleteRule = () => {
    if (!ruleIdPendingDelete) return;
    setRules(prev => prev.filter(r => r.id !== ruleIdPendingDelete));
    if (selectedRuleId === ruleIdPendingDelete) setSelectedRuleId('');
    setRuleIdPendingDelete(null);
    showAppToast('Plan removed. Click "Save configuration" to keep this change.', 'success');
    emitDiagnostic('plan_delete', {
      outcome: 'success'
    });
  };

  // Run live simulation
  const activeRule = rules.find(r => r.id === selectedRuleId) || rules.find(r => r.enabled);
  const simResult = evaluateDepositPlan({
    currency: 'USD',
    lineItems: [{
      catalogItemId: 'demo-product-1',
      productName: 'Sample catalog product',
      quantity: 1,
      price: parseFloat(simSubtotal) || 0,
      collectionIds: activeRule?.targetCollectionIds || []
    }],
    rules,
    selectedRuleId: activeRule?.id
  });
  const canAddAnotherActiveRule = isPaidPlan || activeCount < FREE_PLAN_MAX_ACTIVE_RULES;
  return <Page height="100vh">
      <Page.Header title={<FormattedMessage id="depositcraft.depositcraft-layaway-deposit-plans" defaultMessage="DepositCraft: Layaway & Deposit Plans" />} subtitle="Save deposit plan records, preview schedules, and create order payment requests from Order Details." actionsBar={<Box gap="SP2" verticalAlign="middle">
            {!isPaidPlan && <Tooltip content={!upgradeUrl ? 'Plan details are still loading' : undefined} disabled={Boolean(upgradeUrl)}>
                <Button priority="secondary" skin="premium" onClick={handleUpgrade} disabled={!upgradeUrl}>
                  <FormattedMessage id="depositcraft.upgrade-to-pro" defaultMessage="Upgrade to Pro" />
                </Button>
              </Tooltip>}
            <Button priority="primary" disabled={!storageReady} onClick={() => setIsModalOpen(true)}>
              <FormattedMessage id="depositcraft.create-deposit-plan" defaultMessage="+ Create deposit plan" />
            </Button>
          </Box>} />
      <Page.Content>
        {isInitialLoading ? <Card>
            <Card.Content>
              <Box align="center" verticalAlign="middle" padding="60px 0">
                <Loader text={<FormattedMessage id="depositcraft.loading-your-depositcraft-configuration" defaultMessage="Loading your DepositCraft configuration…" />} />
              </Box>
            </Card.Content>
          </Card> : ecommerceInstalled === false ? <EmptyState theme="page" title={<FormattedMessage id="depositcraft.add-wix-stores-to-use-depositcraft" defaultMessage="Add Wix Stores to use DepositCraft" />} subtitle="DepositCraft configures deposit and installment plans for store orders. Add Wix Stores (or another Wix eCommerce app) to this site, then return here to set up your plans.">
            <Button as="a" href={WIX_STORES_APP_MARKET_URL} target="_blank" rel="noopener noreferrer">
              <FormattedMessage id="depositcraft.add-wix-stores" defaultMessage="Add Wix Stores" />
            </Button>
          </EmptyState> : <Box direction="vertical" gap="SP4">
            {showUpgradeSuccess && <SectionHelper skin="success" onClose={() => setShowUpgradeSuccess(false)}>
                Pro plan active. Unlimited deposit plans, custom schedules, and priority support are unlocked.
              </SectionHelper>}

            {!storageReady && !isInitialLoading && <Card>
                <Card.Content>
                  <Box align="space-between" verticalAlign="middle" gap="SP3">
                    <Box direction="vertical" gap="SP1">
                      <Box gap="SP2" verticalAlign="middle">
                        <Badge skin="warning" size="small"><FormattedMessage id="depositcraft.setup-needed" defaultMessage="Setup needed" /></Badge>
                        <Text weight="bold">{storageStatus}</Text>
                      </Box>
                      {storageDetail && <Text size="tiny" secondary>{storageDetail}</Text>}
                    </Box>
                    <Box gap="SP2">
                      <Button priority="secondary" onClick={() => void reloadStorage(storageState === 'provisioning' || storageState === 'timeout')}>
                        {storageState === 'provisioning' || storageState === 'timeout' ? 'Check again' : 'Retry'}
                      </Button>
                    </Box>
                  </Box>
                </Card.Content>
              </Card>}

            {storageReady && <SectionHelper skin="standard">
                <Box direction="vertical" gap="SP2">
                  <Text weight="bold"><FormattedMessage id="depositcraft.supported" defaultMessage="Supported" /></Text>
                  <Text size="small">
                    Layaway preview at cart/checkout; checkout deposits when you pair each active plan with an automatic discount using its DepositCraft custom trigger
                    {activeRule ? ` (for ${activeRule.name}, about ${deferredDiscountPercent(evaluateDepositPlan({
                currency: 'USD',
                lineItems: [{
                  catalogItemId: 'preview',
                  quantity: 1,
                  price: parseFloat(simSubtotal) || 0
                }],
                rules,
                selectedRuleId: activeRule.id
              })).toFixed(2)}% off when ${depositTriggerName(activeRule.name)} is active)` : ''}
                    ; installment payment links from Order Details; due-date Automations emails after you activate an automation for Installment due reminder (Automations → + New Automation → Send an email, timed to the due date).
                  </Text>
                  <Text weight="bold"><FormattedMessage id="depositcraft.not-supported" defaultMessage="Not supported" /></Text>
                  <Text size="small">
                    Auto-charging saved cards without the buyer present; checkout deposits without your discount setup; collection-scoped plans on orders; external cron or background servers.
                  </Text>
                  <Text>
                    <Text weight="bold"><FormattedMessage id="depositcraft.due-installments" defaultMessage="Due installments:" /> </Text>
                    DepositCraft creates the next payment link when a due date passes or after the previous request is marked paid. Customers always pay manually through your Payment Request Page.
                  </Text>
                  <Box>
                    <Button size="small" priority="secondary" disabled={isBillingRun} onClick={() => {
                setIsBillingRun(true);
                void processDueInstallments().then(result => {
                  showAppToast(result.linksCreated ? `Created ${result.linksCreated} payment link(s) for ${result.dueCount} due installment(s).` : result.dueCount ? 'Due installments already have an open payment link.' : 'No installments are due for billing right now.', 'success');
                }).catch(() => showAppToast('DepositCraft could not process due installments.', 'error')).finally(() => setIsBillingRun(false));
              }}>
                      <FormattedMessage id="depositcraft.process-due-installments" defaultMessage="Process due installments" />
                    </Button>
                  </Box>
                </Box>
              </SectionHelper>}

            {storageReady && !isPaidPlan && <SectionHelper skin="premium" actionText="Upgrade to Pro" onAction={handleUpgrade}>
                <Text weight="bold"><FormattedMessage id="depositcraft.unlock-unlimited-deposit-plans-and-custo" defaultMessage="Unlock unlimited deposit plans and custom schedules." /> </Text>
                <FormattedMessage id="depositcraft.free-plans-support-up-to" defaultMessage="Free plans support up to" /> {FREE_PLAN_MAX_ACTIVE_RULES} active percentage-based plans on a bi-weekly schedule.
                Upgrade to Pro for unlimited plans, fixed-amount deposits, and custom installment frequencies.
              </SectionHelper>}

            {storageReady && rules.length === 0 ? <Card>
                <Card.Content>
                  <EmptyState theme="page" title={<FormattedMessage id="depositcraft.create-your-first-deposit-plan-record" defaultMessage="Create your first deposit plan record" />} subtitle="Define deposit percentage or amount, installment count, and frequency. Pair each active plan with an automatic discount trigger to collect deposits at checkout; balances are collected through payment request links.">
                    <Button priority="primary" onClick={() => setIsModalOpen(true)}>
                      <FormattedMessage id="depositcraft.create-your-first-deposit-plan" defaultMessage="+ Create your first deposit plan" />
                    </Button>
                  </EmptyState>
                </Card.Content>
              </Card> : storageReady && <>
                  <Box gap="SP2" verticalAlign="middle">
                    <Text size="small" secondary>
                      Creating a plan here only saves its configuration and math. DepositCraft never changes checkout’s amount due on its own.
                    </Text>
                    <InfoIcon content="A payment request for the first installment is only created later, from an existing order, and only after the merchant publishes the Payment Request Page." />
                  </Box>

                  <Box gap="SP3">
                    <StatisticsWidget items={[{
              value: `${activeCount} of ${rules.length}`,
              description: 'Active deposit plans'
            }, {
              value: 'Fixed & % splits',
              description: 'Supported deposit structures'
            }, {
              value: '2 - 6 splits',
              description: 'Installment milestones'
            }, {
              value: 'Order card',
              description: 'Payment requests',
              descriptionInfo: 'Create payment links from the DepositCraft card on each order. Customers pay manually; the next link is created after Wix marks the previous request paid.'
            }]} />
                  </Box>

                  <Card>
                    <Card.Header title={<FormattedMessage id="depositcraft.configured-deposit-layaway-plans" defaultMessage="Configured deposit & layaway plans" />} subtitle="Configure plans and preview their math. Saving here does not change checkout or collect payment." />
                    <Card.Divider />
                    <Card.Content>
                      <Table data={rules} columns={[{
                title: 'Plan name',
                render: (row: DepositRule) => <Box direction="vertical">
                                <Text weight="bold">{row.name}</Text>
                                <Text size="tiny" secondary><FormattedMessage id="depositcraft.id" defaultMessage="ID:" /> {row.id}</Text>
                              </Box>
              }, {
                title: 'Deposit required',
                render: (row: DepositRule) => <Box direction="horizontal" gap="SP1" verticalAlign="middle">
                                <Badge skin={row.depositType === 'PERCENTAGE' ? 'standard' : 'general'} size="small">
                                  {row.depositType === 'PERCENTAGE' ? 'Percentage' : 'Fixed amount'}
                                </Badge>
                                <Text weight="bold">
                                  {row.depositType === 'PERCENTAGE' ? `${row.depositValue}%` : `$${row.depositValue.toFixed(2)}`}
                                </Text>
                              </Box>
              }, {
                title: 'Layaway installments',
                render: (row: DepositRule) => <Text size="small">
                                {row.layawayInstallments} x {row.installmentFrequency || 'BIWEEKLY'}
                              </Text>
              }, {
                title: 'Min. order spend',
                render: (row: DepositRule) => <Text size="small">
                                {row.minOrderSubtotal ? `$${row.minOrderSubtotal.toFixed(2)}` : 'No minimum'}
                              </Text>
              }, {
                title: 'Catalog scope',
                render: (row: DepositRule) => <Text size="small">
                                {row.scope === 'ALL_PRODUCTS' ? 'All products' : `Collections: ${(row.targetCollectionIds || []).join(', ') || 'none set'}`}
                              </Text>
              }, {
                title: 'Active',
                render: (row: DepositRule) => <ToggleSwitch checked={row.enabled} onChange={() => toggleRule(row.id)} aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.name}`} />
              }, {
                title: '',
                width: '56px',
                render: (row: DepositRule) => <TableActionCell secondaryActions={[{
                  text: 'Delete plan',
                  icon: <Delete />,
                  skin: 'destructive',
                  onClick: () => setRuleIdPendingDelete(row.id)
                }]} />
              }]}>
                        <Table.Content />
                      </Table>
                    </Card.Content>
                  </Card>

                  {rules.length > 0 && <Card>
                      <Card.Header title={<FormattedMessage id="depositcraft.checkout-layaway-simulator" defaultMessage="Checkout layaway simulator" />} subtitle={<FormattedMessage id="depositcraft.preview-how-the-deposit-and-installment-" defaultMessage="Preview how the deposit and installment breakdown would look to a shopper" />} />
                      <Card.Divider />
                      <Card.Content>
                        <Box gap="SP4" direction="horizontal">
                          <Box direction="vertical" gap="SP2" width="50%">
                            <FormField label={<FormattedMessage id="depositcraft.simulated-cart-subtotal" defaultMessage="Simulated cart subtotal ($)" />}>
                              <NumberInput value={parseFloat(simSubtotal) || 0} onChange={value => setSimSubtotal(String(value ?? 0))} />
                            </FormField>

                            <FormField label={<FormattedMessage id="depositcraft.deposit-plan-to-preview" defaultMessage="Deposit plan to preview" />}>
                              <RadioGroup value={selectedRuleId || activeRule?.id} onChange={value => setSelectedRuleId(String(value))}>
                                {rules.map(r => <RadioGroup.Radio key={r.id} value={r.id}>
                                    <Box direction="vertical">
                                      <Box gap="SP1" verticalAlign="middle">
                                        <Text size="small" weight="bold">{r.name}</Text>
                                        <Badge skin={r.enabled ? 'success' : 'neutral'} size="tiny">
                                          {r.enabled ? 'Enabled' : 'Paused'}
                                        </Badge>
                                      </Box>
                                      <Text size="tiny" secondary>
                                        {r.depositValue}{r.depositType === 'PERCENTAGE' ? '%' : '$'} <FormattedMessage id="depositcraft.down" defaultMessage="down," /> {r.layawayInstallments} <FormattedMessage id="depositcraft.payments" defaultMessage="payments" />
                                      </Text>
                                    </Box>
                                  </RadioGroup.Radio>)}
                              </RadioGroup>
                            </FormField>
                          </Box>

                          <Box direction="vertical" width="50%">
                          <Card>
                            <Card.Content>
                              <Box direction="vertical" gap="SP2">
                                <Heading size="small"><FormattedMessage id="depositcraft.checkout-payment-breakdown" defaultMessage="Checkout payment breakdown" /></Heading>
                                <Divider />

                                <Box align="space-between">
                                  <Text><FormattedMessage id="depositcraft.cart-subtotal" defaultMessage="Cart subtotal:" /></Text>
                                  <Text weight="bold">${parseFloat(simSubtotal || '0').toFixed(2)}</Text>
                                </Box>

                                {simResult.eligible ? <>
                                    <Box align="space-between">
                                      <Text weight="bold"><FormattedMessage id="depositcraft.deposit-due-today-at-checkout" defaultMessage="Deposit due today (at checkout):" /></Text>
                                      <Heading size="small">${simResult.depositDueNow.toFixed(2)}</Heading>
                                    </Box>

                                    <Box align="space-between">
                                      <Text secondary><FormattedMessage id="depositcraft.deferred-layaway-balance" defaultMessage="Deferred layaway balance:" /></Text>
                                      <Text weight="bold">${simResult.remainingBalance.toFixed(2)}</Text>
                                    </Box>

                                    <Divider />
                                    <Heading size="tiny"><FormattedMessage id="depositcraft.upcoming-layaway-installments" defaultMessage="Upcoming layaway installments" /></Heading>

                                    {simResult.layawaySchedule?.schedule.slice(1).map(item => <Box key={item.installmentNumber} padding="SP2" align="space-between" backgroundColor="D80" borderRadius="6px">
                                        <Box direction="vertical">
                                          <Text size="small" weight="bold">{item.label}</Text>
                                          <Text size="tiny" secondary>{item.dueDescription}</Text>
                                        </Box>
                                        <Text weight="bold">${item.amount.toFixed(2)}</Text>
                                      </Box>)}
                                  </> : <SectionHelper skin="warning">
                                    {simResult.breakdownReasons[0] || 'Plan conditions not met.'}
                                  </SectionHelper>}

                                <Divider />
                                <Text size="tiny" secondary>
                                  <FormattedMessage id="depositcraft.preview-only-supports-both-catalog-v1-an" defaultMessage="Preview only. Supports both Catalog V1 and V3 products." />
                                </Text>
                              </Box>
                            </Card.Content>
                          </Card>
                          </Box>
                        </Box>
                      </Card.Content>
                    </Card>}

                  <Card>
                    <Card.Content>
                      <Box align="space-between" verticalAlign="middle" gap="SP3">
                        <Box direction="vertical" gap="SP1">
                          <Text size="small" weight="bold"><FormattedMessage id="depositcraft.before-this-affects-checkout" defaultMessage="Before this affects checkout" /></Text>
                          <Text size="small" secondary>
                            Saving here only updates the plan configuration and preview math. For an existing order, DepositCraft
                            can request the first installment payment and moves to the next one only after that payment is recorded.
                            This needs the merchant’s Payment Request Page to be published; DepositCraft never charges a buyer automatically
                            or adds a deposit to checkout on its own.
                          </Text>
                        </Box>
                        <Box gap="SP2" verticalAlign="middle">
                          <ContactSupportLink subject="DepositCraft: Layaway & Deposits support" />
                          <Button onClick={saveChanges}><FormattedMessage id="depositcraft.save-configuration" defaultMessage="Save configuration" /></Button>
                        </Box>
                      </Box>
                    </Card.Content>
                  </Card>
                </>}
          </Box>}

        {/* Modal to add a deposit plan */}
        <Modal isOpen={isModalOpen} onRequestClose={() => {
        setIsModalOpen(false);
        resetModalForm();
      }} shouldCloseOnOverlayClick>
          <CustomModalLayout title={<FormattedMessage id="depositcraft.create-deposit-layaway-plan" defaultMessage="Create deposit & layaway plan" />} closeButtonProps={{
          onClick: () => {
            setIsModalOpen(false);
            resetModalForm();
          }
        }} primaryButtonText="Save plan" primaryButtonOnClick={handleAddRule} primaryButtonProps={{
          disabled: !newRuleName.trim()
        }} secondaryButtonText="Cancel" secondaryButtonOnClick={() => {
          setIsModalOpen(false);
          resetModalForm();
        }}>
            <Box direction="vertical" gap="SP3">
              {modalGateMessage && <SectionHelper skin="danger" actionText="Upgrade to Pro" onAction={handleUpgrade}>
                  {modalGateMessage}
                </SectionHelper>}
              {!canAddAnotherActiveRule && !isPaidPlan && <SectionHelper skin="warning">
                  <FormattedMessage id="depositcraft.you-already-have" defaultMessage="You already have" /> {FREE_PLAN_MAX_ACTIVE_RULES} active plans on the free plan. This new plan will be saved but
                  turned off until you upgrade or turn another plan off.
                </SectionHelper>}

              <FormField label={<FormattedMessage id="depositcraft.plan-name" defaultMessage="Plan name" />} required>
                <Input placeholder="e.g., Summer bespoke furniture layaway" value={newRuleName} onChange={e => setNewRuleName(e.target.value)} />
              </FormField>

              <Box gap="SP3">
                <Box direction="vertical" width="50%">
                  <FormField label={<FormattedMessage id="depositcraft.deposit-type" defaultMessage="Deposit type" />} infoContent="Percentage deposits scale with the order total. Fixed deposits collect the same amount every time.">
                    <RadioGroup value={newDepositType} onChange={value => setNewDepositType(value as DepositType)} disabledRadios={canUseFixedDeposit(entitlement) ? [] : ['FIXED']}>
                      <RadioGroup.Radio value="PERCENTAGE"><FormattedMessage id="depositcraft.percentage" defaultMessage="Percentage" /></RadioGroup.Radio>
                      <RadioGroup.Radio value="FIXED">
                        <FormattedMessage id="depositcraft.fixed-amount" defaultMessage="Fixed amount" /> {!canUseFixedDeposit(entitlement) && <Badge skin="premium" size="tiny"><FormattedMessage id="depositcraft.pro" defaultMessage="Pro" /></Badge>}
                      </RadioGroup.Radio>
                    </RadioGroup>
                  </FormField>
                </Box>
                <Box direction="vertical" width="50%">
                  <FormField label={newDepositType === 'PERCENTAGE' ? 'Deposit percentage (%)' : 'Deposit amount ($)'}>
                    <NumberInput value={parseFloat(newDepositValue) || 0} onChange={value => setNewDepositValue(String(value ?? 0))} />
                  </FormField>
                </Box>
              </Box>

              <Box gap="SP3">
                <Box direction="vertical" width="50%">
                  <FormField label={<FormattedMessage id="depositcraft.layaway-installments-count" defaultMessage="Layaway installments count" />}>
                    <NumberInput value={parseInt(newInstallments, 10) || 0} onChange={value => setNewInstallments(String(value ?? 0))} />
                  </FormField>
                </Box>
                <Box direction="vertical" width="50%">
                  <FormField label={<FormattedMessage id="depositcraft.installment-frequency" defaultMessage="Installment frequency" />} infoContent={!canUseCustomFrequency(entitlement) ? 'Custom frequencies need the Pro plan. Free plans use every 2 weeks.' : undefined}>
                    <Dropdown selectedId={canUseCustomFrequency(entitlement) ? newFrequency : FREE_PLAN_FIXED_FREQUENCY} disabled={!canUseCustomFrequency(entitlement)} onSelect={option => setNewFrequency(option.id as InstallmentFrequency)} options={FREQUENCY_OPTIONS} />
                  </FormField>
                </Box>
              </Box>

              <FormField label={<FormattedMessage id="depositcraft.min-order-spend-threshold" defaultMessage="Min. order spend threshold ($)" />}>
                <NumberInput value={parseFloat(newMinSubtotal) || 0} onChange={value => setNewMinSubtotal(String(value ?? 0))} />
              </FormField>

              <FormField label={<FormattedMessage id="depositcraft.applies-to" defaultMessage="Applies to" />}>
                <Dropdown selectedId={newScope} onSelect={option => setNewScope(option.id as DepositRuleScope)} options={[{
                id: 'ALL_PRODUCTS',
                value: 'All products'
              }, {
                id: 'COLLECTION',
                value: 'Specific collections'
              }]} />
              </FormField>

              {newScope === 'COLLECTION' && <FormField label={<FormattedMessage id="depositcraft.collection-ids-comma-separated" defaultMessage="Collection IDs (comma-separated)" />} infoContent="Find collection IDs in Wix Stores > Collections.">
                  <Input placeholder="e.g., custom-sofas, luxury-beds" value={newTargetCollections} onChange={e => setNewTargetCollections(e.target.value)} />
                </FormField>}
            </Box>
          </CustomModalLayout>
        </Modal>

        {/* Delete confirmation */}
        <Modal isOpen={Boolean(ruleIdPendingDelete)} onRequestClose={() => setRuleIdPendingDelete(null)} shouldCloseOnOverlayClick>
          <MessageModalLayout title={<FormattedMessage id="depositcraft.delete-this-deposit-plan" defaultMessage="Delete this deposit plan?" />} skin="destructive" primaryButtonText="Delete" primaryButtonOnClick={confirmDeleteRule} primaryButtonProps={{
          skin: 'destructive'
        }} secondaryButtonText="Cancel" secondaryButtonOnClick={() => setRuleIdPendingDelete(null)} closeButtonProps={{
          onClick: () => setRuleIdPendingDelete(null)
        }}>
            <FormattedMessage id="depositcraft.this-removes-the-plan-named" defaultMessage="This removes the plan named “" />{rules.find(r => r.id === ruleIdPendingDelete)?.name}” after you save configuration.
            Any order already using this plan keeps its existing payment schedule.
          </MessageModalLayout>
        </Modal>
      </Page.Content>
    </Page>;
}
function DepositCraftPage() {
  return <WixDesignSystemProvider>
      <ErrorBoundary>
        <DepositCraftDashboard />
      </ErrorBoundary>
    </WixDesignSystemProvider>;
}
export default withIntlProvider(DepositCraftPage);