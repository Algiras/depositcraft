import { withIntlProvider } from '../../intl/withIntlProvider';
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl';
import React, { useEffect, useRef, useState } from 'react';
import { appInstances } from '@wix/app-management';
import { WixDesignSystemProvider, Page, Card, Table, TableActionCell, Button, TextButton, Badge, ToggleSwitch, Input, NumberInput, FormField, Modal, CustomModalLayout, MessageModalLayout, Box, Heading, Text, Divider, EmptyState, SectionHelper, StatisticsWidget, RadioGroup, Dropdown, Loader, InfoIcon } from '@wix/design-system';
import { Delete, Checklist } from '@wix/wix-ui-icons-common';
import '@wix/design-system/styles.global.css';
import { InstallationChecklist, StorageSetupNeeded, type ChecklistItem } from '@wix-extensions/core/ui';
import { loadConfiguration, saveConfiguration, assessConfigurationStorage } from '../../shared/configuration';
import { confirmStorageWithAutoRetry, extractRequestId, storageDetailHint, type StorageSetupState, type StorageCheckItem } from '../../shared/storage-readiness';
import { emitDiagnostic, markDashboardLoaded, markSetupFinished } from '../../shared/logger';
import { showAppToast } from '../../shared/toast';
import { getAppEntitlement, canUsePaidFeatures, getWixPricingPageUrl, AppEntitlement } from '../../shared/entitlement';
import { evaluateRuleAgainstPlan, canUseFixedDeposit, canUseCustomFrequency, FREE_PLAN_MAX_ACTIVE_RULES, FREE_PLAN_FIXED_FREQUENCY } from '../../shared/plan-limits';
import { DepositRule, DepositType, DepositRuleScope, InstallmentFrequency } from '../../types';
import { evaluateDepositPlan } from '../../backend/deposit-engine';
import { resolveEcommerceInstalled, WIX_ECOMMERCE_APP_MARKET_URL, type EcommerceInstallState } from '../../shared/ecommerce';
import { deferredDiscountPercent } from '../../shared/cart-evaluation';
import { depositTriggerName } from '../../shared/deposit-trigger-id';
import { processDueInstallments, listPaymentLedgerPage } from '../../shared/installment-billing';
import type { PaymentLedger } from '../../shared/payment-ledger';
const APP_ID = 'cecd3584-c6bd-4895-a776-613643ef171d';
const SUPPORT_EMAIL = 'kras.algim@gmail.com';
const CURRENCY = 'USD';
const LEDGER_PAGE_SIZE = 25;

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
      return <Page minWidth={0} maxWidth={0} sidePadding={48}>
          <Page.Content>
            <Card>
              <Card.Content>
                <Box direction="vertical" gap="12px">
                  <Heading size="small"><FormattedMessage id="app.errorBoundary.title" defaultMessage="Something went wrong loading the dashboard." /></Heading>
                  <Text size="small" secondary>{this.state.error || <FormattedMessage id="app.errorBoundary.detail" defaultMessage="Reload this page or contact support if the problem continues." />}</Text>
                  <Box>
                    <Button onClick={() => this.setState({
                    hasError: false,
                    error: ''
                  })}><FormattedMessage id="app.common.tryAgain" defaultMessage="Try again" /></Button>
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
      <FormattedMessage id="app.common.contactSupport" defaultMessage="Contact support" />
    </TextButton>;
}
function frequencyMessageId(freq: InstallmentFrequency | undefined): string {
  if (freq === 'WEEKLY') return 'app.frequency.weekly';
  if (freq === 'MONTHLY') return 'app.frequency.monthly';
  return 'app.frequency.biweekly';
}
function frequencyLabel(intl: IntlShape, freq: InstallmentFrequency | undefined): string {
  const id = frequencyMessageId(freq);
  const defaults: Record<string, string> = {
    'app.frequency.weekly': 'Weekly',
    'app.frequency.biweekly': 'Every 2 weeks',
    'app.frequency.monthly': 'Monthly'
  };
  return intl.formatMessage({
    id,
    defaultMessage: defaults[id]
  });
}
function frequencyOptions(intl: IntlShape): {
  id: InstallmentFrequency;
  value: string;
}[] {
  return [{
    id: 'WEEKLY',
    value: frequencyLabel(intl, 'WEEKLY')
  }, {
    id: 'BIWEEKLY',
    value: frequencyLabel(intl, 'BIWEEKLY')
  }, {
    id: 'MONTHLY',
    value: frequencyLabel(intl, 'MONTHLY')
  }];
}
function storageMessageId(state: StorageSetupState | null): string {
  if (state === 'cms_required') return 'app.storage.cmsRequired';
  if (state === 'schema_mismatch') return 'app.storage.schemaMismatch';
  if (state === 'provisioning' || state === 'timeout') return 'app.storage.provisioning';
  return 'app.storage.error';
}
function storageMessageDefault(state: StorageSetupState | null): string {
  if (state === 'cms_required') return 'Add Wix CMS to this site, update this app to the latest version, then click Retry.';
  if (state === 'schema_mismatch') return 'DepositCraft storage on this site does not match the latest app version. Open Manage Apps, update DepositCraft to the latest version, then click Retry.';
  if (state === 'provisioning' || state === 'timeout') return 'DepositCraft is still provisioning private storage after install or update. This usually finishes within 10–15 minutes — click Check again or keep this page open.';
  return 'We could not confirm storage is set up. Keep this page open and try again, or contact support if this continues.';
}
function storageHintId(state: StorageSetupState | null): string {
  if (state === 'provisioning' || state === 'timeout') return 'app.storage.hintProvisioning';
  if (state === 'schema_mismatch') return 'app.storage.hintSchemaMismatch';
  if (state === 'cms_required') return 'app.storage.hintCmsRequired';
  return 'app.storage.hintDefault';
}
function storageHintDefault(state: StorageSetupState | null): string {
  if (state === 'provisioning' || state === 'timeout') return 'App storage is provisioned automatically after install or update. Waiting a few minutes and clicking Check again is usually enough.';
  if (state === 'schema_mismatch') return 'Update the app in Manage Apps so Wix can sync the latest storage schema, then click Retry.';
  if (state === 'cms_required') return 'Add Wix CMS from the App Market if your site does not have it, then update DepositCraft and click Retry.';
  return 'If this continues, contact support with your Wix request ID.';
}
function formatMoney(intl: IntlShape, value: number): string {
  return intl.formatNumber(value, {
    style: 'currency',
    currency: CURRENCY
  });
}
function formatDepositValue(intl: IntlShape, depositType: DepositType, value: number): string {
  if (depositType === 'PERCENTAGE') {
    return intl.formatNumber(value / 100, {
      style: 'percent',
      maximumFractionDigits: 2
    });
  }
  return formatMoney(intl, value);
}
function DepositCraftDashboard() {
  const intl = useIntl();
  const [rules, setRules] = useState<DepositRule[]>([]);
  const [storageState, setStorageState] = useState<StorageSetupState | null>(null);
  const [storageRequestId, setStorageRequestId] = useState<string | undefined>(undefined);
  const [storageCheckItems, setStorageCheckItems] = useState<StorageCheckItem[]>([]);
  const [showSystemChecklist, setShowSystemChecklist] = useState(false);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  // Latest-value mirrors for the mount-effect's provisioning poll interval
  // (its closure is created once; reading state directly would go stale).
  const storageStateRef = useRef(storageState);
  const storageReadyRef = useRef(storageReady);
  const isInitialLoadingRef = useRef(isInitialLoading);
  storageStateRef.current = storageState;
  storageReadyRef.current = storageReady;
  isInitialLoadingRef.current = isInitialLoading;
  const [instanceId, setInstanceId] = useState('');
  const [ecommerceInstalled, setEcommerceInstalled] = useState<EcommerceInstallState>(undefined);
  const [entitlement, setEntitlement] = useState<AppEntitlement>({
    status: 'unavailable'
  });
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);
  const [isBillingRun, setIsBillingRun] = useState(false);
  const [ledgerItems, setLedgerItems] = useState<PaymentLedger[]>([]);
  const [ledgerCursor, setLedgerCursor] = useState<string | undefined>(undefined);
  const [ledgerHasNext, setLedgerHasNext] = useState(false);
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);
  const [isLedgerLoadingMore, setIsLedgerLoadingMore] = useState(false);
  const wasPaidRef = useRef(false);
  const loadLedgerPage = async (cursor?: string) => {
    if (cursor) setIsLedgerLoadingMore(true); else setIsLedgerLoading(true);
    try {
      const page = await listPaymentLedgerPage({
        cursor,
        pageSize: LEDGER_PAGE_SIZE
      });
      setLedgerItems(prev => cursor ? [...prev, ...page.items] : page.items);
      setLedgerCursor(page.nextCursor);
      setLedgerHasNext(page.hasNext);
    } catch (error) {
      showAppToast(intl.formatMessage({
        id: 'app.ledger.loadErrorToast',
        defaultMessage: 'DepositCraft could not load the payment ledger.'
      }), 'error');
    } finally {
      if (cursor) setIsLedgerLoadingMore(false); else setIsLedgerLoading(false);
    }
  };
  const reloadStorage = async (autoRetry = false) => {
    const start = Date.now();
    setIsCheckingStorage(true);
    try {
      setStorageRequestId(undefined);
      const readiness = autoRetry ? await confirmStorageWithAutoRetry(() => assessConfigurationStorage()) : await assessConfigurationStorage();
      setStorageState(readiness.state);
      if (readiness.items) setStorageCheckItems(readiness.items);
      if (!readiness.ready) {
        emitDiagnostic('storage_verify', {
          outcome: 'failure',
          durationMs: Date.now() - start,
          errorCode: readiness.state.toUpperCase(),
          wixRequestId: readiness.requestId,
          surface: 'dashboard'
        });
        setStorageReady(false);
        setStorageRequestId(readiness.requestId);
        return;
      }
      const saved = await loadConfiguration<DepositRule>();
      setRules(saved);
      setStorageReady(true);
      setStorageState('ready');
      markSetupFinished();
      setLedgerItems([]);
      setLedgerCursor(undefined);
      setLedgerHasNext(false);
      void loadLedgerPage();
      emitDiagnostic('storage_verify', {
        outcome: 'success',
        durationMs: Date.now() - start,
        surface: 'dashboard'
      });
    } catch (error) {
      const requestId = extractRequestId(error);
      setStorageState('error');
      emitDiagnostic('storage_verify', {
        outcome: 'failure',
        durationMs: Date.now() - start,
        errorCode: 'ERROR',
        wixRequestId: requestId,
        surface: 'dashboard'
      });
      setStorageReady(false);
      setStorageRequestId(requestId);
    } finally {
      setIsCheckingStorage(false);
    }
  };
  const refreshEntitlement = () => {
    void getAppEntitlement().then(value => {
      const isPaidNow = canUsePaidFeatures(value);
      if (isPaidNow && !wasPaidRef.current) {
        setShowUpgradeSuccess(true);
        showAppToast(intl.formatMessage({
          id: 'app.dashboard.upgradeSuccessToast',
          defaultMessage: 'Pro plan active. Unlimited plans and custom schedules are unlocked.'
        }), 'success');
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
      // First load auto-retries provisioning states (5/10/15s) while the
      // loader is showing, so slow propagation recovers without a click.
      await Promise.all([reloadStorage(true), Promise.resolve(refreshEntitlement())]);
      setIsInitialLoading(false);
    })();
    // The provisioning loader promises the page updates automatically: keep
    // re-checking every 15s while that loader is on screen, stopping the
    // moment storage turns ready or a recovery state takes over.
    const visibleButNotReady = () => !storageReadyRef.current && !isInitialLoadingRef.current
      && (storageStateRef.current === 'provisioning' || storageStateRef.current === 'timeout');
    const interval = setInterval(() => {
      if (visibleButNotReady()) void reloadStorage(false);
    }, 15_000);
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
      clearInterval(interval);
      window.removeEventListener('focus', refreshEntitlement);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const isPaidPlan = canUsePaidFeatures(entitlement);
  const upgradeUrl = instanceId ? getWixPricingPageUrl(APP_ID, instanceId) : undefined;
  const saveChanges = async () => {
    try {
      await saveConfiguration(rules);
      showAppToast(intl.formatMessage({
        id: 'app.dashboard.savedToast',
        defaultMessage: 'Configuration saved.'
      }), 'success');
      emitDiagnostic('plan_save', {
        outcome: 'success'
      });
    } catch (error) {
      showAppToast(intl.formatMessage({
        id: 'app.dashboard.saveFailedToast',
        defaultMessage: 'Your changes were not saved. Please try again.'
      }), 'error');
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
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);

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
  const planGateMessage = (reason: string | undefined): string => {
    switch (reason) {
      case 'FREE_FIXED_DEPOSIT':
        return intl.formatMessage({
          id: 'app.modal.freeFixedDepositMessage',
          defaultMessage: 'Fixed-amount deposits need the Pro plan. The free plan supports percentage-based deposits.'
        });
      case 'FREE_CUSTOM_FREQUENCY':
        return intl.formatMessage({
          id: 'app.modal.freeCustomFrequencyMessage',
          defaultMessage: 'Custom installment schedules need the Pro plan. The free plan uses a bi-weekly schedule.'
        });
      case 'FREE_RULE_LIMIT':
        return intl.formatMessage({
          id: 'app.modal.freeRuleLimitMessage',
          defaultMessage: 'The free plan supports up to {limit, plural, one {# active deposit plan} other {# active deposit plans}}. Upgrade to Pro for unlimited plans.'
        }, {
          limit: FREE_PLAN_MAX_ACTIVE_RULES
        });
      default:
        return intl.formatMessage({
          id: 'app.modal.notAvailableOnCurrentPlan',
          defaultMessage: 'This plan is not available on your current plan.'
        });
    }
  };
  const toggleRule = (id: string) => {
    const target = rules.find(r => r.id === id);
    if (!target) return;
    if (!target.enabled) {
      const gate = evaluateRuleAgainstPlan(target, entitlement, activeCount);
      if (!gate.allowed) {
        showAppToast(gate.reason ? planGateMessage(gate.reason) : intl.formatMessage({
          id: 'app.modal.needsProPlan',
          defaultMessage: 'This plan needs the Pro plan.'
        }), 'error');
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
      setModalGateMessage(planGateMessage(gate.reason));
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
    showAppToast(intl.formatMessage({
      id: 'app.modal.planCreatedToast',
      defaultMessage: 'Plan created. Click “Save configuration” to keep it.'
    }), 'success');
    emitDiagnostic('plan_create', {
      outcome: 'success'
    });
  };
  const confirmDeleteRule = () => {
    if (!ruleIdPendingDelete) return;
    setRules(prev => prev.filter(r => r.id !== ruleIdPendingDelete));
    if (selectedRuleId === ruleIdPendingDelete) setSelectedRuleId('');
    setRuleIdPendingDelete(null);
    showAppToast(intl.formatMessage({
      id: 'app.modal.planRemovedToast',
      defaultMessage: 'Plan removed. Click “Save configuration” to keep this change.'
    }), 'success');
    emitDiagnostic('plan_delete', {
      outcome: 'success'
    });
  };

  // Run live simulation
  const activeRule = rules.find(r => r.id === selectedRuleId) || rules.find(r => r.enabled);
  const simResult = evaluateDepositPlan({
    currency: CURRENCY,
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
  const storageStatusText = isCheckingStorage ? intl.formatMessage({
    id: 'app.storage.checking',
    defaultMessage: 'Checking whether your storage is set up…'
  }) : intl.formatMessage({
    id: storageMessageId(storageState),
    defaultMessage: storageMessageDefault(storageState)
  });
  const storageHintText = [intl.formatMessage({
    id: storageHintId(storageState),
    defaultMessage: storageHintDefault(storageState)
  }), storageRequestId ? intl.formatMessage({
    id: 'app.storage.requestIdSuffix',
    defaultMessage: '(Wix request ID: {requestId})'
  }, {
    requestId: storageRequestId
  }) : ''].filter(Boolean).join(' ');
  const renderLiveChecklist = () => {
    const plansCheck = storageCheckItems.find(i => i.id.includes('depositcraft-plans'));
    const ledgerCheck = storageCheckItems.find(i => i.id.includes('depositcraft-payment-ledger'));

    const checklistItems: ChecklistItem[] = [
      {
        id: 'ecommerce',
        title: intl.formatMessage({ id: 'app.checklist.ecommerceTitle', defaultMessage: 'Wix Stores & eCommerce' }),
        detail: ecommerceInstalled === null
          ? intl.formatMessage({ id: 'app.checklist.ecommerceChecking', defaultMessage: 'Detecting eCommerce installation…' })
          : ecommerceInstalled === false
          ? intl.formatMessage({ id: 'app.checklist.ecommerceMissing', defaultMessage: 'Wix Stores not detected on site' })
          : intl.formatMessage({ id: 'app.checklist.ecommerceReady', defaultMessage: 'Connected and ready' }),
        status: ecommerceInstalled === null ? 'checking' : ecommerceInstalled === false ? 'warning' : 'complete',
        badgeText: ecommerceInstalled === null
          ? intl.formatMessage({ id: 'app.checklist.badgeChecking', defaultMessage: 'Checking…' })
          : ecommerceInstalled === false
          ? intl.formatMessage({ id: 'app.checklist.badgeRequired', defaultMessage: 'Required' })
          : intl.formatMessage({ id: 'app.checklist.badgeReady', defaultMessage: 'Ready' }),
      },
      {
        id: 'plans-collection',
        title: intl.formatMessage({ id: 'app.checklist.plansTitle', defaultMessage: 'Deposit Plans Storage' }),
        detail: isCheckingStorage && !plansCheck
          ? intl.formatMessage({ id: 'app.checklist.plansChecking', defaultMessage: 'Verifying collection metadata…' })
          : plansCheck?.ready || storageReady
          ? intl.formatMessage({ id: 'app.checklist.plansReady', defaultMessage: 'Private collection active (@krasalgim/depositcraft/depositcraft-plans)' })
          : plansCheck?.status === 'schema_mismatch'
          ? plansCheck.detail || intl.formatMessage({ id: 'app.checklist.schemaMismatch', defaultMessage: 'Schema mismatch — update app in Manage Apps' })
          : intl.formatMessage({ id: 'app.checklist.plansProvisioning', defaultMessage: 'Awaiting private storage provisioning by Wix' }),
        status: (plansCheck?.ready || storageReady)
          ? 'complete'
          : isCheckingStorage
          ? 'checking'
          : plansCheck?.status === 'schema_mismatch'
          ? 'danger'
          : 'warning',
        badgeText: (plansCheck?.ready || storageReady)
          ? intl.formatMessage({ id: 'app.checklist.badgeReady', defaultMessage: 'Ready' })
          : isCheckingStorage
          ? intl.formatMessage({ id: 'app.checklist.badgeChecking', defaultMessage: 'Checking…' })
          : plansCheck?.status === 'schema_mismatch'
          ? intl.formatMessage({ id: 'app.checklist.badgeUpdateNeeded', defaultMessage: 'Update needed' })
          : intl.formatMessage({ id: 'app.checklist.badgeProvisioning', defaultMessage: 'Provisioning' }),
        missingPermissions: plansCheck?.missingPermissions,
      },
      {
        id: 'ledger-collection',
        title: intl.formatMessage({ id: 'app.checklist.ledgerTitle', defaultMessage: 'Payment Ledger Storage' }),
        detail: isCheckingStorage && !ledgerCheck
          ? intl.formatMessage({ id: 'app.checklist.ledgerChecking', defaultMessage: 'Verifying ledger collection…' })
          : ledgerCheck?.ready || storageReady
          ? intl.formatMessage({ id: 'app.checklist.ledgerReady', defaultMessage: 'Private ledger collection active (@krasalgim/depositcraft/depositcraft-payment-ledger)' })
          : ledgerCheck?.status === 'schema_mismatch'
          ? ledgerCheck.detail || intl.formatMessage({ id: 'app.checklist.schemaMismatch', defaultMessage: 'Schema mismatch — update app in Manage Apps' })
          : intl.formatMessage({ id: 'app.checklist.ledgerProvisioning', defaultMessage: 'Awaiting private storage provisioning by Wix' }),
        status: (ledgerCheck?.ready || storageReady)
          ? 'complete'
          : isCheckingStorage
          ? 'checking'
          : ledgerCheck?.status === 'schema_mismatch'
          ? 'danger'
          : 'warning',
        badgeText: (ledgerCheck?.ready || storageReady)
          ? intl.formatMessage({ id: 'app.checklist.badgeReady', defaultMessage: 'Ready' })
          : isCheckingStorage
          ? intl.formatMessage({ id: 'app.checklist.badgeChecking', defaultMessage: 'Checking…' })
          : ledgerCheck?.status === 'schema_mismatch'
          ? intl.formatMessage({ id: 'app.checklist.badgeUpdateNeeded', defaultMessage: 'Update needed' })
          : intl.formatMessage({ id: 'app.checklist.badgeProvisioning', defaultMessage: 'Provisioning' }),
        missingPermissions: ledgerCheck?.missingPermissions,
      },
      {
        id: 'configuration',
        title: intl.formatMessage({ id: 'app.checklist.configTitle', defaultMessage: 'App Configuration & Active Plans' }),
        detail: storageReady
          ? intl.formatMessage({
              id: 'app.checklist.configReady',
              defaultMessage: '{count, plural, =0 {Ready (0 saved plans)} one {Ready (# active plan)} other {Ready (# active plans)}}'
            }, { count: rules.length })
          : isCheckingStorage
          ? intl.formatMessage({ id: 'app.checklist.configLoading', defaultMessage: 'Loading saved configuration…' })
          : intl.formatMessage({ id: 'app.checklist.configPending', defaultMessage: 'Awaiting storage setup' }),
        status: storageReady ? 'complete' : isCheckingStorage ? 'checking' : 'pending',
        badgeText: storageReady
          ? intl.formatMessage({ id: 'app.checklist.badgeLoaded', defaultMessage: 'Loaded' })
          : isCheckingStorage
          ? intl.formatMessage({ id: 'app.checklist.badgeLoading', defaultMessage: 'Loading…' })
          : intl.formatMessage({ id: 'app.checklist.badgePending', defaultMessage: 'Pending' }),
      },
      {
        id: 'entitlement',
        title: intl.formatMessage({ id: 'app.checklist.entitlementTitle', defaultMessage: 'Subscription Tier & Limits' }),
        detail: entitlement.status === 'unavailable'
          ? intl.formatMessage({ id: 'app.checklist.entitlementChecking', defaultMessage: 'Verifying subscription plan…' })
          : isPaidPlan
          ? intl.formatMessage({ id: 'app.checklist.entitlementPro', defaultMessage: 'Pro plan active (unlimited plans unlocked)' })
          : intl.formatMessage({ id: 'app.checklist.entitlementFree', defaultMessage: 'Free tier active (1 active plan limit)' }),
        status: entitlement.status === 'unavailable' ? 'checking' : 'complete',
        badgeText: entitlement.status === 'unavailable'
          ? intl.formatMessage({ id: 'app.checklist.badgeChecking', defaultMessage: 'Checking…' })
          : isPaidPlan
          ? intl.formatMessage({ id: 'app.checklist.badgeProPlan', defaultMessage: 'Pro Plan' })
          : intl.formatMessage({ id: 'app.checklist.badgeFreePlan', defaultMessage: 'Free Plan' }),
      },
    ];

    const completedCount = checklistItems.filter(i => i.status === 'complete').length;
    const totalCount = checklistItems.length;
    const progressPercent = Math.round((completedCount / totalCount) * 100);

    return (
      <InstallationChecklist
        title={
          <Box gap="SP2" verticalAlign="middle">
            <Checklist size="20px" />
            <Text weight="bold">
              <FormattedMessage id="app.checklist.cardTitle" defaultMessage="Live Component Checklist" />
            </Text>
          </Box>
        }
        subtitle={
          <Text size="tiny" secondary>
            <FormattedMessage
              id="app.checklist.cardSubtitle"
              defaultMessage="{completed} of {total} components ready ({percent}%)"
              values={{ completed: completedCount, total: totalCount, percent: progressPercent }}
            />
          </Text>
        }
        items={checklistItems}
        progressPercent={progressPercent}
        completedCount={completedCount}
        totalCount={totalCount}
        isLoading={isCheckingStorage}
        onRetry={() => void reloadStorage(false)}
        retryLabel={<FormattedMessage id="app.common.retry" defaultMessage="Retry" />}
        missingPermissionsLabel={<FormattedMessage id="app.checklist.missingPermissionsLabel" defaultMessage="Missing permissions:" />}
      />
    );
  };

  return <Page height="100vh" minWidth={0} maxWidth={0} sidePadding={48}>
      <Page.Header title={intl.formatMessage({ id: 'app.dashboard.pageTitle', defaultMessage: 'DepositCraft: Layaway & Deposit Plans' })} subtitle={intl.formatMessage({ id: 'app.dashboard.pageSubtitle', defaultMessage: 'Save deposit plan records, preview schedules, and create order payment requests from Order Details.' })} actionsBar={<Box gap="SP2" verticalAlign="middle">
            {storageReady && <TextButton size="small" prefixIcon={<Checklist size="16px" />} onClick={() => setShowSystemChecklist(prev => !prev)}>
                <FormattedMessage id="app.dashboard.systemStatusButton" defaultMessage="System status" />
              </TextButton>}
            <Button priority="primary" disabled={!storageReady} onClick={() => setIsModalOpen(true)}>
              <FormattedMessage id="app.dashboard.createPlanButton" defaultMessage="+ Create deposit plan" />
            </Button>
          </Box>} />
      <Page.Content>
        {isInitialLoading ? <Box direction="vertical" gap="SP4">
            <Card>
              <Card.Content>
                <Box align="center" verticalAlign="middle" padding="36px 0">
                  <Loader text={intl.formatMessage({ id: 'app.dashboard.loadingConfig', defaultMessage: 'Loading your DepositCraft configuration…' })} />
                </Box>
              </Card.Content>
            </Card>
            {renderLiveChecklist()}
          </Box> : ecommerceInstalled === false ? <EmptyState theme="page" title={intl.formatMessage({ id: 'app.dashboard.addStoresTitle', defaultMessage: 'Add an eCommerce app to use DepositCraft' })} subtitle={intl.formatMessage({ id: 'app.dashboard.addStoresSubtitle', defaultMessage: 'DepositCraft configures deposit and installment plans for store orders. Add Wix Stores, Wix Bookings, or Wix Restaurants Orders — or any other Wix eCommerce app — to this site, then return here to set up your plans.' })}>
            <Button as="a" href={WIX_ECOMMERCE_APP_MARKET_URL} target="_blank" rel="noopener noreferrer">
              <FormattedMessage id="app.dashboard.addStoresButton" defaultMessage="Browse eCommerce apps" />
            </Button>
          </EmptyState> : <Box direction="vertical" gap="SP4">
            {showUpgradeSuccess && <SectionHelper skin="success" onClose={() => setShowUpgradeSuccess(false)}>
                <FormattedMessage id="app.dashboard.upgradeSuccessBanner" defaultMessage="Pro plan active. Unlimited deposit plans, custom schedules, and priority support are unlocked." />
              </SectionHelper>}

            {!storageReady && !isInitialLoading && (storageState === 'provisioning' || storageState === 'timeout'
              ? <Box direction="vertical" gap="SP4">
                <StorageSetupNeeded
                  variant="page"
                  state={storageState}
                  title={intl.formatMessage({ id: 'app.storage.onboardingTitle', defaultMessage: 'Welcome to DepositCraft' })}
                  subtitle={intl.formatMessage({ id: 'app.storage.onboardingSubtitle', defaultMessage: 'We are setting up your secure private storage. This happens once on install and usually takes 5-10 minutes. This page will refresh automatically when ready.' })}
                  isChecking={isCheckingStorage}
                />
                {renderLiveChecklist()}
              </Box>
              : <Box direction="vertical" gap="SP4">
                <StorageSetupNeeded
                  variant="inline"
                  state={storageState ?? 'error'}
                  title={storageStatusText}
                  subtitle={isCheckingStorage ? '' : storageHintText}
                  details={isCheckingStorage ? undefined : storageDetailHint(storageState ?? 'error')}
                  requestId={isCheckingStorage ? undefined : storageRequestId}
                  requestIdLabel={<FormattedMessage id="app.storage.requestIdLabel" defaultMessage="Wix request ID:" />}
                  detailsShowLabel={<FormattedMessage id="app.storage.detailsShowLabel" defaultMessage="Show details for support" />}
                  detailsHideLabel={<FormattedMessage id="app.storage.detailsHideLabel" defaultMessage="Hide details" />}
                  isChecking={isCheckingStorage}
                  onRetry={() => void reloadStorage(false)}
                  retryLabel={<FormattedMessage id="app.common.retry" defaultMessage="Retry" />}
                />
                {renderLiveChecklist()}
              </Box>)}

            {storageReady && showSystemChecklist && renderLiveChecklist()}

            {storageReady && rules.length === 0 && <Card>
                <Card.Content>
                  <EmptyState theme="page" title={intl.formatMessage({ id: 'app.dashboard.emptyStateTitle', defaultMessage: 'Create your first deposit plan record' })} subtitle={intl.formatMessage({ id: 'app.dashboard.emptyStateSubtitle', defaultMessage: 'Define deposit percentage or amount, installment count, and frequency. Pair each active plan with an automatic discount trigger to collect deposits at checkout; balances are collected through payment request links.' })}>
                    <Button priority="primary" onClick={() => setIsModalOpen(true)}>
                      <FormattedMessage id="app.dashboard.emptyStateButton" defaultMessage="+ Create your first deposit plan" />
                    </Button>
                  </EmptyState>
                </Card.Content>
              </Card>}

            {storageReady && rules.length > 0 && <>
                  <Box gap="SP2" verticalAlign="middle">
                    <Text size="small" secondary>
                      <FormattedMessage id="app.dashboard.createOnlySavesHint" defaultMessage="Creating a plan here only saves its configuration and math. DepositCraft never changes checkout’s amount due on its own." />
                    </Text>
                    <InfoIcon content={intl.formatMessage({
                id: 'app.dashboard.paymentRequestInfoIcon',
                defaultMessage: 'A payment request for the first installment is only created later, from an existing order, and only after the merchant publishes the Payment Request Page.'
              })} />
                  </Box>

                  <Box gap="SP3">
                    <StatisticsWidget items={[{
              value: intl.formatMessage({
                id: 'app.dashboard.statActivePlansValue',
                defaultMessage: '{active} of {total}'
              }, {
                active: activeCount,
                total: rules.length
              }),
              description: intl.formatMessage({
                id: 'app.dashboard.statActivePlansLabel',
                defaultMessage: 'Active deposit plans'
              })
            }, {
              value: intl.formatMessage({
                id: 'app.dashboard.statStructuresValue',
                defaultMessage: 'Fixed & % splits'
              }),
              description: intl.formatMessage({
                id: 'app.dashboard.statStructuresLabel',
                defaultMessage: 'Supported deposit structures'
              })
            }, {
              value: intl.formatMessage({
                id: 'app.dashboard.statMilestonesValue',
                defaultMessage: '2 - 6 splits'
              }),
              description: intl.formatMessage({
                id: 'app.dashboard.statMilestonesLabel',
                defaultMessage: 'Installment milestones'
              })
            }, {
              value: intl.formatMessage({
                id: 'app.dashboard.statPaymentsValue',
                defaultMessage: 'Order card'
              }),
              description: intl.formatMessage({
                id: 'app.dashboard.statPaymentsLabel',
                defaultMessage: 'Payment requests'
              }),
              descriptionInfo: intl.formatMessage({
                id: 'app.dashboard.statPaymentsInfo',
                defaultMessage: 'Create payment links from the DepositCraft card on each order. Customers pay manually; the next link is created after Wix marks the previous request paid.'
              })
            }]} />
                  </Box>

                  <Card>
                    <Card.Header title={intl.formatMessage({
                    id: 'app.dashboard.configuredPlansTitle',
                    defaultMessage: 'Configured deposit & layaway plans'
                  })} subtitle={intl.formatMessage({
                    id: 'app.dashboard.configuredPlansSubtitle',
                    defaultMessage: 'Configure plans and preview their math. Saving here does not change checkout or collect payment.'
                  })} />
                    <Card.Divider />
                    <Card.Content>
                      <Table data={rules} columns={[{
                title: intl.formatMessage({
                  id: 'app.table.planNameHeader',
                  defaultMessage: 'Plan name'
                }),
                render: (row: DepositRule) => <Box direction="vertical">
                                <Text weight="bold">{row.name}</Text>
                                <Text size="tiny" secondary><FormattedMessage id="app.table.idPrefix" defaultMessage="ID:" /> {row.id}</Text>
                              </Box>
              }, {
                title: intl.formatMessage({
                  id: 'app.table.depositRequiredHeader',
                  defaultMessage: 'Deposit required'
                }),
                render: (row: DepositRule) => <Box direction="horizontal" gap="SP1" verticalAlign="middle">
                                <Badge skin={row.depositType === 'PERCENTAGE' ? 'standard' : 'general'} size="small">
                                  {row.depositType === 'PERCENTAGE' ? <FormattedMessage id="app.common.percentage" defaultMessage="Percentage" /> : <FormattedMessage id="app.common.fixedAmount" defaultMessage="Fixed amount" />}
                                </Badge>
                                <Text weight="bold">
                                  {formatDepositValue(intl, row.depositType, row.depositValue)}
                                </Text>
                              </Box>
              }, {
                title: intl.formatMessage({
                  id: 'app.table.layawayInstallmentsHeader',
                  defaultMessage: 'Layaway installments'
                }),
                render: (row: DepositRule) => <Text size="small">
                                {intl.formatMessage({
                    id: 'app.table.installmentsValue',
                    defaultMessage: '{count} × {frequency}'
                  }, {
                    count: row.layawayInstallments,
                    frequency: frequencyLabel(intl, row.installmentFrequency || 'BIWEEKLY')
                  })}
                              </Text>
              }, {
                title: intl.formatMessage({
                  id: 'app.table.minSpendHeader',
                  defaultMessage: 'Min. order spend'
                }),
                render: (row: DepositRule) => <Text size="small">
                                {row.minOrderSubtotal ? formatMoney(intl, row.minOrderSubtotal) : <FormattedMessage id="app.table.noMinimum" defaultMessage="No minimum" />}
                              </Text>
              }, {
                title: intl.formatMessage({
                  id: 'app.table.catalogScopeHeader',
                  defaultMessage: 'Catalog scope'
                }),
                render: (row: DepositRule) => <Text size="small">
                                {row.scope === 'ALL_PRODUCTS' ? <FormattedMessage id="app.common.allProducts" defaultMessage="All products" /> : intl.formatMessage({
                    id: 'app.table.collectionsScope',
                    defaultMessage: 'Collections: {list}'
                  }, {
                    list: (row.targetCollectionIds || []).join(', ') || intl.formatMessage({
                      id: 'app.table.noCollectionsSet',
                      defaultMessage: 'none set'
                    })
                  })}
                              </Text>
              }, {
                title: intl.formatMessage({
                  id: 'app.table.activeHeader',
                  defaultMessage: 'Active'
                }),
                render: (row: DepositRule) => <ToggleSwitch checked={row.enabled} onChange={() => toggleRule(row.id)} aria-label={intl.formatMessage({
                  id: row.enabled ? 'app.table.toggleAriaDisable' : 'app.table.toggleAriaEnable',
                  defaultMessage: row.enabled ? 'Disable {name}' : 'Enable {name}'
                }, {
                  name: row.name
                })} />
              }, {
                title: '',
                width: '56px',
                render: (row: DepositRule) => <TableActionCell secondaryActions={[{
                  text: intl.formatMessage({
                    id: 'app.table.deletePlanAction',
                    defaultMessage: 'Delete plan'
                  }),
                  icon: <Delete />,
                  skin: 'destructive',
                  onClick: () => setRuleIdPendingDelete(row.id)
                }]} />
              }]}>
                        <Table.Content />
                      </Table>
                    </Card.Content>
                  </Card>
                </>}

            {storageReady && <SectionHelper skin="standard" actionText={intl.formatMessage({
          id: 'app.dashboard.learnMoreButton',
          defaultMessage: 'Learn more'
        })} onAction={() => setIsReferenceModalOpen(true)}>
                <FormattedMessage id="app.dashboard.referenceSectionHelperText" defaultMessage="See what DepositCraft supports today at checkout, and what still needs setup elsewhere." />
              </SectionHelper>}

            {storageReady && !isPaidPlan && <SectionHelper skin="premium" actionText={intl.formatMessage({
          id: 'app.common.upgradeToPro',
          defaultMessage: 'Upgrade to Pro'
        })} onAction={handleUpgrade}>
                <Text weight="bold"><FormattedMessage id="app.dashboard.unlockUnlimitedTitle" defaultMessage="Unlock unlimited deposit plans and custom schedules." /> </Text>
                <FormattedMessage id="app.dashboard.freePlanLimitDescription" defaultMessage="Free plans support up to {limit, plural, one {# active percentage-based plan} other {# active percentage-based plans}} on a bi-weekly schedule. Upgrade to Pro for unlimited plans, fixed-amount deposits, and custom installment frequencies." values={{
            limit: FREE_PLAN_MAX_ACTIVE_RULES
          }} />
              </SectionHelper>}

            {storageReady && rules.length > 0 && <Card>
                <Card.Content>
                  <Box align="space-between" verticalAlign="middle" gap="SP3">
                    <Box direction="vertical" gap="SP1">
                      <Text size="small" weight="bold"><FormattedMessage id="app.dashboard.dueInstallmentsLabel" defaultMessage="Due installments:" /></Text>
                      <Text size="small" secondary>
                        <FormattedMessage id="app.dashboard.dueInstallmentsDescription" defaultMessage="DepositCraft creates the next payment link when a due date passes or after the previous request is marked paid. Customers always pay manually through your Payment Request Page." />
                      </Text>
                    </Box>
                    <Button size="small" priority="secondary" disabled={isBillingRun} onClick={() => {
                setIsBillingRun(true);
                void processDueInstallments().then(result => {
                  const message = result.linksCreated ? intl.formatMessage({
                    id: 'app.dashboard.processDueSuccess',
                    defaultMessage: '{linksCreated, plural, one {Created # payment link} other {Created # payment links}} for {dueCount, plural, one {# due installment} other {# due installments}}.'
                  }, {
                    linksCreated: result.linksCreated,
                    dueCount: result.dueCount
                  }) : result.dueCount ? intl.formatMessage({
                    id: 'app.dashboard.processDueAlreadyOpen',
                    defaultMessage: 'Due installments already have an open payment link.'
                  }) : intl.formatMessage({
                    id: 'app.dashboard.processDueNoneNow',
                    defaultMessage: 'No installments are due for billing right now.'
                  });
                  showAppToast(message, 'success');
                }).catch(() => showAppToast(intl.formatMessage({
                  id: 'app.dashboard.processDueError',
                  defaultMessage: 'DepositCraft could not process due installments.'
                }), 'error')).finally(() => setIsBillingRun(false));
              }}>
                      <FormattedMessage id="app.dashboard.processDueInstallmentsButton" defaultMessage="Process due installments" />
                    </Button>
                  </Box>
                </Card.Content>
              </Card>}

            {storageReady && rules.length > 0 && <Card>
                    <Card.Header title={intl.formatMessage({
                    id: 'app.ledger.title',
                    defaultMessage: 'Payment ledger'
                  })} subtitle={intl.formatMessage({
                    id: 'app.ledger.subtitle',
                    defaultMessage: 'Installment payments recorded for orders that used a deposit plan.'
                  })} />
                    <Card.Divider />
                    <Card.Content>
                      {isLedgerLoading ? <Box align="center" verticalAlign="middle" padding="40px 0">
                          <Loader size="small" text={intl.formatMessage({
                        id: 'app.ledger.loadingText',
                        defaultMessage: 'Loading payment ledger…'
                      })} />
                        </Box> : ledgerItems.length === 0 ? <EmptyState theme="section" title={intl.formatMessage({
                        id: 'app.ledger.emptyStateTitle',
                        defaultMessage: 'No payments recorded yet'
                      })} subtitle={intl.formatMessage({
                        id: 'app.ledger.emptyStateSubtitle',
                        defaultMessage: 'Payment ledger entries appear here after a customer completes a deposit checkout.'
                      })} /> : <Box direction="vertical" gap="SP3">
                          <Table data={ledgerItems} columns={[{
                        title: intl.formatMessage({
                          id: 'app.ledger.orderIdHeader',
                          defaultMessage: 'Order ID'
                        }),
                        render: (row: PaymentLedger) => <Text size="small" weight="bold">{row.orderId}</Text>
                      }, {
                        title: intl.formatMessage({
                          id: 'app.ledger.totalHeader',
                          defaultMessage: 'Order total'
                        }),
                        render: (row: PaymentLedger) => <Text size="small">{formatMoney(intl, row.totalOrderAmount)}</Text>
                      }, {
                        title: intl.formatMessage({
                          id: 'app.ledger.installmentsHeader',
                          defaultMessage: 'Installments'
                        }),
                        render: (row: PaymentLedger) => <Text size="small">
                                        {intl.formatMessage({
                            id: 'app.ledger.installmentsProgressValue',
                            defaultMessage: '{paid} of {total} paid'
                          }, {
                            paid: row.installments.filter(i => i.status === 'PAID').length,
                            total: row.installments.length
                          })}
                                      </Text>
                      }]}>
                            <Table.Content />
                          </Table>

                          <Box align="space-between" verticalAlign="middle" gap="SP3">
                            <Text size="tiny" secondary>
                              {ledgerHasNext ? <FormattedMessage id="app.ledger.countPartial" defaultMessage="Showing {shown, plural, one {# payment} other {# payments}}. More are available." values={{
                            shown: ledgerItems.length
                          }} /> : <FormattedMessage id="app.ledger.countComplete" defaultMessage="Showing all {shown, plural, one {# payment} other {# payments}}." values={{
                            shown: ledgerItems.length
                          }} />}
                            </Text>
                            {ledgerHasNext && <Button priority="secondary" size="small" disabled={isLedgerLoadingMore} onClick={() => void loadLedgerPage(ledgerCursor)}>
                                <FormattedMessage id="app.ledger.loadMoreButton" defaultMessage="Load more" />
                              </Button>}
                          </Box>
                        </Box>}
                    </Card.Content>
                  </Card>}

            {storageReady && rules.length > 0 && <Card>
                      <Card.Header title={intl.formatMessage({
                      id: 'app.simulator.title',
                      defaultMessage: 'Checkout layaway simulator'
                    })} subtitle={intl.formatMessage({
                      id: 'app.simulator.subtitle',
                      defaultMessage: 'Preview how the deposit and installment breakdown would look to a shopper'
                    })} />
                      <Card.Divider />
                      <Card.Content>
                        <Box gap="SP4" direction="horizontal">
                          <Box direction="vertical" gap="SP2" width="50%">
                            <FormField label={intl.formatMessage({
                          id: 'app.simulator.subtotalLabel',
                          defaultMessage: 'Simulated cart subtotal ({currency})'
                        }, {
                          currency: CURRENCY
                        })}>
                              <NumberInput value={parseFloat(simSubtotal) || 0} onChange={value => setSimSubtotal(String(value ?? 0))} />
                            </FormField>

                            <FormField label={intl.formatMessage({
                          id: 'app.simulator.planToPreviewLabel',
                          defaultMessage: 'Deposit plan to preview'
                        })}>
                              <RadioGroup value={selectedRuleId || activeRule?.id} onChange={value => setSelectedRuleId(String(value))}>
                                {rules.map(r => <RadioGroup.Radio key={r.id} value={r.id}>
                                    <Box direction="vertical">
                                      <Box gap="SP1" verticalAlign="middle">
                                        <Text size="small" weight="bold">{r.name}</Text>
                                        <Badge skin={r.enabled ? 'success' : 'neutral'} size="tiny">
                                          {r.enabled ? <FormattedMessage id="app.simulator.enabledBadge" defaultMessage="Enabled" /> : <FormattedMessage id="app.simulator.pausedBadge" defaultMessage="Paused" />}
                                        </Badge>
                                      </Box>
                                      <Text size="tiny" secondary>
                                        <FormattedMessage id="app.simulator.downPayments" defaultMessage="{value} down, {count, plural, one {# payment} other {# payments}}" values={{
                                    value: formatDepositValue(intl, r.depositType, r.depositValue),
                                    count: r.layawayInstallments
                                  }} />
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
                                <Heading size="small"><FormattedMessage id="app.simulator.breakdownTitle" defaultMessage="Checkout payment breakdown" /></Heading>
                                <Divider />

                                <Box align="space-between">
                                  <Text><FormattedMessage id="app.simulator.cartSubtotalLabel" defaultMessage="Cart subtotal:" /></Text>
                                  <Text weight="bold">{formatMoney(intl, parseFloat(simSubtotal || '0'))}</Text>
                                </Box>

                                {simResult.eligible ? <>
                                    <Box align="space-between">
                                      <Text weight="bold"><FormattedMessage id="app.simulator.depositDueLabel" defaultMessage="Deposit due today (at checkout):" /></Text>
                                      <Heading size="small">{formatMoney(intl, simResult.depositDueNow)}</Heading>
                                    </Box>

                                    <Box align="space-between">
                                      <Text secondary><FormattedMessage id="app.simulator.deferredBalanceLabel" defaultMessage="Deferred layaway balance:" /></Text>
                                      <Text weight="bold">{formatMoney(intl, simResult.remainingBalance)}</Text>
                                    </Box>

                                    <Divider />
                                    <Heading size="tiny"><FormattedMessage id="app.simulator.upcomingInstallmentsTitle" defaultMessage="Upcoming layaway installments" /></Heading>

                                    {simResult.layawaySchedule?.schedule.slice(1).map(item => {
                                const freq = activeRule?.installmentFrequency || 'BIWEEKLY';
                                const weeksPer = freq === 'WEEKLY' ? 1 : freq === 'MONTHLY' ? 4 : 2;
                                const weeks = item.installmentNumber * weeksPer;
                                return <Box key={item.installmentNumber} padding="SP2" align="space-between" backgroundColor="D80" borderRadius="6px">
                                        <Box direction="vertical">
                                          <Text size="small" weight="bold"><FormattedMessage id="app.simulator.installmentLabel" defaultMessage="Layaway installment #{number}" values={{
                                        number: item.installmentNumber
                                      }} /></Text>
                                          <Text size="tiny" secondary><FormattedMessage id="app.simulator.installmentDueIn" defaultMessage="In {weeks, plural, one {# week} other {# weeks}}" values={{
                                        weeks
                                      }} /></Text>
                                        </Box>
                                        <Text weight="bold">{formatMoney(intl, item.amount)}</Text>
                                      </Box>;
                              })}
                                  </> : <SectionHelper skin="warning">
                                    <FormattedMessage id="app.simulator.noPlanEligible" defaultMessage="Plan conditions not met." />
                                  </SectionHelper>}

                                <Divider />
                                <Text size="tiny" secondary>
                                  <FormattedMessage id="app.simulator.previewFootnote" defaultMessage="Preview only. Supports both Catalog V1 and V3 products." />
                                </Text>
                              </Box>
                            </Card.Content>
                          </Card>
                          </Box>
                        </Box>
                      </Card.Content>
                    </Card>}

            {storageReady && rules.length > 0 && <Card>
                    <Card.Content>
                      <Box align="space-between" verticalAlign="middle" gap="SP3">
                        <Box direction="vertical" gap="SP1">
                          <Text size="small" weight="bold"><FormattedMessage id="app.dashboard.beforeAffectsCheckoutTitle" defaultMessage="Before this affects checkout" /></Text>
                          <Text size="small" secondary>
                            <FormattedMessage id="app.dashboard.beforeAffectsCheckoutBody" defaultMessage="Saving here only updates the plan configuration and preview math. For an existing order, DepositCraft can request the first installment payment and moves to the next one only after that payment is recorded. This needs the merchant’s Payment Request Page to be published; DepositCraft never charges a buyer automatically or adds a deposit to checkout on its own." />
                          </Text>
                        </Box>
                        <Box gap="SP2" verticalAlign="middle">
                          <ContactSupportLink subject={intl.formatMessage({
                        id: 'app.dashboard.contactSupportSubject',
                        defaultMessage: 'DepositCraft: Layaway & Deposits support'
                      })} />
                          <Button onClick={saveChanges}><FormattedMessage id="app.dashboard.saveConfigurationButton" defaultMessage="Save configuration" /></Button>
                        </Box>
                      </Box>
                    </Card.Content>
                  </Card>}
          </Box>}

        {/* Modal to add a deposit plan */}
        <Modal isOpen={isModalOpen} onRequestClose={() => {
        setIsModalOpen(false);
        resetModalForm();
      }} shouldCloseOnOverlayClick>
          <CustomModalLayout title={intl.formatMessage({
          id: 'app.modal.createPlanTitle',
          defaultMessage: 'Create deposit & layaway plan'
        })} closeButtonProps={{
          onClick: () => {
            setIsModalOpen(false);
            resetModalForm();
          }
        }} primaryButtonText={intl.formatMessage({
          id: 'app.modal.savePlanButton',
          defaultMessage: 'Save plan'
        })} primaryButtonOnClick={handleAddRule} primaryButtonProps={{
          disabled: !newRuleName.trim()
        }} secondaryButtonText={intl.formatMessage({
          id: 'app.common.cancel',
          defaultMessage: 'Cancel'
        })} secondaryButtonOnClick={() => {
          setIsModalOpen(false);
          resetModalForm();
        }}>
            <Box direction="vertical" gap="SP3">
              {modalGateMessage && <SectionHelper skin="danger" actionText={intl.formatMessage({
                id: 'app.common.upgradeToPro',
                defaultMessage: 'Upgrade to Pro'
              })} onAction={handleUpgrade}>
                  {modalGateMessage}
                </SectionHelper>}
              {!canAddAnotherActiveRule && !isPaidPlan && <SectionHelper skin="warning">
                  <FormattedMessage id="app.modal.alreadyHaveActivePlans" defaultMessage="You already have {limit, plural, one {# active plan} other {# active plans}} on the free plan. This new plan will be saved but turned off until you upgrade or turn another plan off." values={{
                limit: FREE_PLAN_MAX_ACTIVE_RULES
              }} />
                </SectionHelper>}

              <FormField label={intl.formatMessage({ id: 'app.modal.planNameLabel', defaultMessage: 'Plan name' })} required>
                <Input placeholder={intl.formatMessage({
                id: 'app.modal.planNamePlaceholder',
                defaultMessage: 'e.g., Summer bespoke furniture layaway'
              })} value={newRuleName} onChange={e => setNewRuleName(e.target.value)} />
              </FormField>

              <Box gap="SP3">
                <Box direction="vertical" width="50%">
                  <FormField label={intl.formatMessage({ id: 'app.modal.depositTypeLabel', defaultMessage: 'Deposit type' })} infoContent={intl.formatMessage({
                  id: 'app.modal.depositTypeInfo',
                  defaultMessage: 'Percentage deposits scale with the order total. Fixed deposits collect the same amount every time.'
                })}>
                    <RadioGroup value={newDepositType} onChange={value => setNewDepositType(value as DepositType)} disabledRadios={canUseFixedDeposit(entitlement) ? [] : ['FIXED']}>
                      <RadioGroup.Radio value="PERCENTAGE"><FormattedMessage id="app.common.percentage" defaultMessage="Percentage" /></RadioGroup.Radio>
                      <RadioGroup.Radio value="FIXED">
                        <FormattedMessage id="app.common.fixedAmount" defaultMessage="Fixed amount" /> {!canUseFixedDeposit(entitlement) && <Badge skin="premium" size="tiny"><FormattedMessage id="app.common.pro" defaultMessage="Pro" /></Badge>}
                      </RadioGroup.Radio>
                    </RadioGroup>
                  </FormField>
                </Box>
                <Box direction="vertical" width="50%">
                  <FormField label={newDepositType === 'PERCENTAGE' ? intl.formatMessage({
                  id: 'app.modal.depositPercentageLabel',
                  defaultMessage: 'Deposit percentage (%)'
                }) : intl.formatMessage({
                  id: 'app.modal.depositAmountLabel',
                  defaultMessage: 'Deposit amount ({currency})'
                }, {
                  currency: CURRENCY
                })}>
                    <NumberInput value={parseFloat(newDepositValue) || 0} onChange={value => setNewDepositValue(String(value ?? 0))} />
                  </FormField>
                </Box>
              </Box>

              <Box gap="SP3">
                <Box direction="vertical" width="50%">
                  <FormField label={intl.formatMessage({ id: 'app.modal.layawayInstallmentsCountLabel', defaultMessage: 'Layaway installments count' })}>
                    <NumberInput value={parseInt(newInstallments, 10) || 0} onChange={value => setNewInstallments(String(value ?? 0))} />
                  </FormField>
                </Box>
                <Box direction="vertical" width="50%">
                  <FormField label={intl.formatMessage({ id: 'app.modal.installmentFrequencyLabel', defaultMessage: 'Installment frequency' })} infoContent={!canUseCustomFrequency(entitlement) ? intl.formatMessage({
                  id: 'app.modal.installmentFrequencyInfo',
                  defaultMessage: 'Custom frequencies need the Pro plan. Free plans use every 2 weeks.'
                }) : undefined}>
                    <Dropdown selectedId={canUseCustomFrequency(entitlement) ? newFrequency : FREE_PLAN_FIXED_FREQUENCY} disabled={!canUseCustomFrequency(entitlement)} onSelect={option => setNewFrequency(option.id as InstallmentFrequency)} options={frequencyOptions(intl)} />
                  </FormField>
                </Box>
              </Box>

              <FormField label={intl.formatMessage({ id: 'app.modal.minOrderSpendLabel', defaultMessage: 'Min. order spend threshold ({currency})' }, { currency: CURRENCY })}>
                <NumberInput value={parseFloat(newMinSubtotal) || 0} onChange={value => setNewMinSubtotal(String(value ?? 0))} />
              </FormField>

              <FormField label={intl.formatMessage({ id: 'app.modal.appliesToLabel', defaultMessage: 'Applies to' })}>
                <Dropdown selectedId={newScope} onSelect={option => setNewScope(option.id as DepositRuleScope)} options={[{
                id: 'ALL_PRODUCTS',
                value: intl.formatMessage({
                  id: 'app.common.allProducts',
                  defaultMessage: 'All products'
                })
              }, {
                id: 'COLLECTION',
                value: intl.formatMessage({
                  id: 'app.common.specificCollections',
                  defaultMessage: 'Specific collections'
                })
              }]} />
              </FormField>

              {newScope === 'COLLECTION' && <FormField label={intl.formatMessage({ id: 'app.modal.collectionIdsLabel', defaultMessage: 'Collection IDs (comma-separated)' })} infoContent={intl.formatMessage({
              id: 'app.modal.collectionIdsInfo',
              defaultMessage: 'Find collection IDs in Wix Stores > Collections.'
            })}>
                  <Input placeholder={intl.formatMessage({
                id: 'app.modal.collectionIdsPlaceholder',
                defaultMessage: 'e.g., custom-sofas, luxury-beds'
              })} value={newTargetCollections} onChange={e => setNewTargetCollections(e.target.value)} />
                </FormField>}
            </Box>
          </CustomModalLayout>
        </Modal>

        {/* Delete confirmation */}
        <Modal isOpen={Boolean(ruleIdPendingDelete)} onRequestClose={() => setRuleIdPendingDelete(null)} shouldCloseOnOverlayClick>
          <MessageModalLayout title={intl.formatMessage({
          id: 'app.deleteModal.title',
          defaultMessage: 'Delete this deposit plan?'
        })} skin="destructive" primaryButtonText={intl.formatMessage({
          id: 'app.common.delete',
          defaultMessage: 'Delete'
        })} primaryButtonOnClick={confirmDeleteRule} primaryButtonProps={{
          skin: 'destructive'
        }} secondaryButtonText={intl.formatMessage({
          id: 'app.common.cancel',
          defaultMessage: 'Cancel'
        })} secondaryButtonOnClick={() => setRuleIdPendingDelete(null)} closeButtonProps={{
          onClick: () => setRuleIdPendingDelete(null)
        }}>
            <FormattedMessage id="app.deleteModal.body" defaultMessage="This removes the plan named “{name}” after you save configuration. Any order already using this plan keeps its existing payment schedule." values={{
            name: rules.find(r => r.id === ruleIdPendingDelete)?.name ?? ''
          }} />
          </MessageModalLayout>
        </Modal>

        {/* Reference: what DepositCraft supports today, and what it does not */}
        <Modal isOpen={isReferenceModalOpen} onRequestClose={() => setIsReferenceModalOpen(false)} shouldCloseOnOverlayClick>
          <CustomModalLayout title={intl.formatMessage({
          id: 'app.dashboard.referenceModalTitle',
          defaultMessage: 'What DepositCraft supports'
        })} closeButtonProps={{
          onClick: () => setIsReferenceModalOpen(false)
        }} primaryButtonText={intl.formatMessage({
          id: 'app.dashboard.referenceModalCloseButton',
          defaultMessage: 'Close'
        })} primaryButtonOnClick={() => setIsReferenceModalOpen(false)}>
            <Box direction="horizontal" gap="SP4">
              <Box direction="vertical" gap="SP2" width="50%">
                <Text weight="bold"><FormattedMessage id="app.dashboard.supportedTitle" defaultMessage="Supported" /></Text>
                <Text size="small">
                  {activeRule ? <FormattedMessage id="app.dashboard.supportedSummaryWithRule" defaultMessage="Layaway preview at cart/checkout; checkout deposits when you pair each active plan with an automatic discount using its DepositCraft custom trigger (for {ruleName}, about {percent} off when {triggerName} is active); installment payment links from Order Details; due-date Automations emails after you activate an automation for Installment due reminder (Automations → + New Automation → Send an email, timed to the due date)." values={{
                  ruleName: activeRule.name,
                  triggerName: depositTriggerName(activeRule.name),
                  percent: intl.formatNumber(deferredDiscountPercent(evaluateDepositPlan({
                    currency: CURRENCY,
                    lineItems: [{
                      catalogItemId: 'preview',
                      quantity: 1,
                      price: parseFloat(simSubtotal) || 0
                    }],
                    rules,
                    selectedRuleId: activeRule.id
                  })) / 100, {
                    style: 'percent',
                    maximumFractionDigits: 2
                  })
                }} /> : <FormattedMessage id="app.dashboard.supportedSummaryNoRule" defaultMessage="Layaway preview at cart/checkout; checkout deposits when you pair each active plan with an automatic discount using its DepositCraft custom trigger; installment payment links from Order Details; due-date Automations emails after you activate an automation for Installment due reminder (Automations → + New Automation → Send an email, timed to the due date)." />}
                </Text>
              </Box>
              <Box direction="vertical" gap="SP2" width="50%">
                <Text weight="bold"><FormattedMessage id="app.dashboard.notSupportedTitle" defaultMessage="Not supported" /></Text>
                <Text size="small">
                  <FormattedMessage id="app.dashboard.notSupportedSummary" defaultMessage="Auto-charging saved cards without the buyer present; checkout deposits without your discount setup; collection-scoped plans on orders; external cron or background servers." />
                </Text>
              </Box>
            </Box>
          </CustomModalLayout>
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
