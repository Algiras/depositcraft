// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import type { DepositRule } from '../../types';

// --- Shared module mocks -----------------------------------------------
// These keep the test focused on layout/structure: no real Wix Data, billing
// or automations calls happen during render.

let rulesFixture: DepositRule[] = [];

const configuration = vi.hoisted(() => ({
  loadConfiguration: vi.fn(),
  saveConfiguration: vi.fn().mockResolvedValue(undefined),
  assessConfigurationStorage: vi.fn().mockResolvedValue({ ready: true, state: 'ready' }),
}));
vi.mock('../../shared/configuration', () => configuration);

vi.mock('../../shared/storage-readiness', () => ({
  confirmStorageWithAutoRetry: (probe: () => Promise<unknown>) => probe(),
  extractRequestId: () => undefined,
  storageDetailHint: () => '',
}));

vi.mock('../../shared/logger', () => ({
  emitDiagnostic: vi.fn(),
  markDashboardLoaded: vi.fn(),
  markSetupFinished: vi.fn(),
  logger: { trackUsage: vi.fn() },
}));

vi.mock('../../shared/toast', () => ({
  showAppToast: vi.fn(),
}));

vi.mock('../../shared/entitlement', () => ({
  getAppEntitlement: vi.fn().mockResolvedValue({ status: 'free' }),
  canUsePaidFeatures: (entitlement: { status: string }) => entitlement.status === 'paid',
  getWixPricingPageUrl: () => 'https://example.com/pricing',
  AppEntitlement: {},
}));

vi.mock('../../shared/ecommerce', () => ({
  resolveEcommerceInstalled: () => true,
  WIX_STORES_APP_MARKET_URL: 'https://example.com/stores',
  WIX_ECOMMERCE_APP_MARKET_URL: 'https://example.com/ecommerce',
}));

vi.mock('../../shared/installment-billing', () => ({
  processDueInstallments: vi.fn().mockResolvedValue({ linksCreated: 0, dueCount: 0 }),
  listPaymentLedgerPage: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined, hasNext: false }),
}));

vi.mock('@wix/app-management', () => ({
  appInstances: {
    getAppInstance: vi.fn().mockResolvedValue({ instance: { instanceId: 'test-instance' }, site: { installedWixApps: [] } }),
  },
}));

vi.mock('@wix/dashboard', () => ({
  dashboard: { navigate: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  rulesFixture = [];
  configuration.loadConfiguration.mockImplementation(() => Promise.resolve(rulesFixture));
  configuration.assessConfigurationStorage.mockResolvedValue({ ready: true, state: 'ready' });
});

/** True when `a` appears before `b` in document order (DOM position, not raw HTML text offset —
 * safe for text containing characters like "&" that get escaped in innerHTML). */
function appearsBefore(a: Element, b: Element): boolean {
  // eslint-disable-next-line no-bitwise
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

async function renderDashboard() {
  const { default: DepositCraftPage } = await import('./page');
  render(<DepositCraftPage />);
  // Wait for the initial storage/entitlement load to settle.
  await waitFor(() => {
    expect(configuration.loadConfiguration).toHaveBeenCalled();
  });
}

describe('DepositCraft dashboard: information hierarchy', () => {
  it('renders the first-run empty state before the reference "Learn more" helper (empty state is not below the fold)', async () => {
    rulesFixture = [];
    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Create your first deposit plan record')).toBeTruthy();
    });

    const emptyState = screen.getByText('Create your first deposit plan record');
    const learnMore = screen.getByText('Learn more');

    expect(appearsBefore(emptyState, learnMore)).toBe(true);
  });

  it('renders the configured plans table before the reference helper once plans exist', async () => {
    rulesFixture = [{
      id: 'rule-1',
      name: 'Sofa layaway',
      depositType: 'PERCENTAGE',
      depositValue: 25,
      layawayInstallments: 4,
      installmentFrequency: 'BIWEEKLY',
      scope: 'ALL_PRODUCTS',
      enabled: true,
    }];
    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Configured deposit & layaway plans')).toBeTruthy();
    });

    const table = screen.getByText('Configured deposit & layaway plans');
    const learnMore = screen.getByText('Learn more');

    expect(appearsBefore(table, learnMore)).toBe(true);
  });

  it('does not render the Supported/Not supported reference content until "Learn more" is opened', async () => {
    rulesFixture = [];
    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Learn more')).toBeTruthy();
    });

    // Collapsed by default: the detailed reference copy is not in the document.
    expect(screen.queryByText('Supported')).toBeNull();
    expect(screen.queryByText('Not supported')).toBeNull();

    fireEvent.click(screen.getByText('Learn more'));

    await waitFor(() => {
      expect(screen.getByText('Supported')).toBeTruthy();
    });
    expect(screen.getByText('Not supported')).toBeTruthy();
  });

  it('shows exactly one "Upgrade to Pro" call to action for a free-plan merchant', async () => {
    rulesFixture = [{
      id: 'rule-1',
      name: 'Sofa layaway',
      depositType: 'PERCENTAGE',
      depositValue: 25,
      layawayInstallments: 4,
      installmentFrequency: 'BIWEEKLY',
      scope: 'ALL_PRODUCTS',
      enabled: true,
    }];
    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Configured deposit & layaway plans')).toBeTruthy();
    });

    expect(screen.getAllByText('Upgrade to Pro')).toHaveLength(1);
  });

  it('keeps the due-installments explanation paired with its own action, separate from the general reference helper', async () => {
    rulesFixture = [{
      id: 'rule-1',
      name: 'Sofa layaway',
      depositType: 'PERCENTAGE',
      depositValue: 25,
      layawayInstallments: 4,
      installmentFrequency: 'BIWEEKLY',
      scope: 'ALL_PRODUCTS',
      enabled: true,
    }];
    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Process due installments')).toBeTruthy();
    });

    const dueLabel = screen.getByText('Due installments:');
    const dueButton = screen.getByText('Process due installments');
    const learnMore = screen.getByText('Learn more');

    // The explanation and its action live in the same card...
    const dueCard = dueLabel.closest('[class*="Card"]');
    expect(dueCard).not.toBeNull();
    expect(dueCard?.contains(dueButton)).toBe(true);
    // ...which is a separate element from the collapsed general reference helper.
    expect(dueCard?.contains(learnMore)).toBe(false);
    expect(appearsBefore(dueLabel, dueButton)).toBe(true);
  });
});
