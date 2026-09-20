import { expect, test, type Page } from '@playwright/test';

// react-intl logs a MISSING_TRANSLATION console error whenever a locale's message catalog is
// incomplete (e.g. our de.json doesn't cover every key yet). That's a known, benign harness/i18n
// gap unrelated to app correctness, so it's the only console noise we allow through.
const ALLOWED_CONSOLE_PATTERNS = [/MISSING_TRANSLATION/];

function attachErrorCollectors(page: Page, errors: string[]) {
  page.on('pageerror', error => {
    errors.push(`pageerror: ${error.message}`);
    console.log('HARNESS_PAGE_ERROR', error.message);
  });
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    console.log('HARNESS_CONSOLE_ERROR', text);
    if (ALLOWED_CONSOLE_PATTERNS.some(pattern => pattern.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
}

let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  attachErrorCollectors(page, consoleErrors);
  await page.goto('./');
  await expect(page.getByText('Loading your DepositCraft configuration…')).toBeHidden();
});

test.afterEach(() => {
  expect(consoleErrors, `Unexpected console/page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});

test('dashboard renders header, primary action, KPI cards, table with plans, and simulator', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'DepositCraft: Layaway & Deposit Plans' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Create deposit plan' })).toBeVisible();
  await expect(page.getByRole('table').getByText('Luxury Furniture Layaway Plan')).toBeVisible();
  await expect(page.getByText('Checkout payment breakdown')).toBeVisible();
  await expect(page.getByText('Deposit due today (at checkout):')).toBeVisible();
});

test('no page-number pagination control exists anywhere in the UI', async ({ page }) => {
  // Bare page-number buttons (1, 2, 3, ...) are how a classic pager renders; DepositCraft should
  // only ever offer cursor-based "Load more", never offset/page-number navigation.
  await expect(page.getByRole('button', { name: /^\d+$/ })).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByText(/page \d+ of \d+/i)).toHaveCount(0);
});

test('free plan displays Pro Tier card and header upgrade button', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Upgrade to Pro' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upgrade to Pro' }).nth(1)).toBeVisible();
  await expect(page.getByText('Unlock unlimited deposit plans and custom schedules.')).toBeVisible();
});

test('paid plan hides Pro Tier card and header upgrade button', async ({ page }) => {
  await page.goto('./?plan=paid');
  await expect(page.getByText('Loading your DepositCraft configuration…')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toHaveCount(0);
  await expect(page.getByText('Unlock unlimited deposit plans and custom schedules.')).toBeHidden();
});

test('storage provisioning shows an auto-updating loader and recovers without a click', async ({ page }) => {
  await page.clock.install();
  await page.goto('./?storage=fail');

  // First-load auto-retry runs checks at 0/5/15/30s; the mock fails all four,
  // so at ~31s the initial loader hands off to the provisioning loader.
  await page.clock.runFor(31_000);
  await expect(page.getByText('Setting up DepositCraft storage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);

  // The loader polls every 15s on its own; the 5th check succeeds.
  await page.clock.runFor(21_000);
  await expect(page.getByRole('button', { name: '+ Create deposit plan' })).toBeEnabled();
  await expect(page.getByRole('table').getByText('Luxury Furniture Layaway Plan')).toBeVisible();
});

test('interactive simulator updates deposit calculation on cart subtotal change', async ({ page }) => {
  const subtotalInput = page.getByLabel('Simulated cart subtotal (USD)');
  await subtotalInput.fill('2000.00');
  await expect(page.getByRole('heading', { name: '$500.00' })).toBeVisible();
});

test('modal opens with its form fields, and Cancel closes it without creating a plan', async ({ page }) => {
  const initialRowCount = await page.getByRole('table').first().getByRole('row').count();

  await page.getByRole('button', { name: '+ Create deposit plan' }).click();
  await expect(page.getByRole('heading', { name: 'Create deposit & layaway plan' })).toBeVisible();

  // Form fields for a new plan are all present.
  await expect(page.getByPlaceholder('e.g., Summer bespoke furniture layaway')).toBeVisible();
  await expect(page.getByText('Deposit type')).toBeVisible();
  await expect(page.getByText('Deposit percentage (%)')).toBeVisible();
  await expect(page.getByText('Layaway installments count')).toBeVisible();
  await expect(page.getByText('Installment frequency')).toBeVisible();
  await expect(page.getByText('Min. order spend threshold (USD)')).toBeVisible();
  await expect(page.getByText('Applies to')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Create deposit & layaway plan' })).toBeHidden();

  // Cancelling made no changes to the table.
  await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(initialRowCount);
});

test('creating a plan through the modal adds it to the table', async ({ page }) => {
  // The free plan already ships two active default rules, at the free-tier active-rule cap, so a
  // third active plan would correctly be gated. Use the paid plan here to exercise plain creation.
  await page.goto('./?plan=paid');
  await expect(page.getByText('Loading your DepositCraft configuration…')).toBeHidden();

  await page.getByRole('button', { name: '+ Create deposit plan' }).click();
  await page.getByPlaceholder('e.g., Summer bespoke furniture layaway').fill('Test Harness Plan');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('heading', { name: 'Create deposit & layaway plan' })).toBeHidden();
  await expect(page.getByRole('table').first().getByText('Test Harness Plan')).toBeVisible();
});

test('payment ledger paginates: Load more appends the next page and then disappears', async ({ page }) => {
  await expect(page.getByText('Payment ledger')).toBeVisible();

  const ledgerTable = page.getByRole('table').nth(1);
  // Seeded with 30 records at a 25-item page size: first page shows 25 rows and "more available".
  await expect(ledgerTable.getByRole('row')).toHaveCount(26); // 25 data rows + 1 header row
  await expect(page.getByText('Showing 25 payments. More are available.')).toBeVisible();

  const loadMoreButton = page.getByRole('button', { name: 'Load more' });
  await expect(loadMoreButton).toBeVisible();
  await loadMoreButton.click();

  // Second (final) page brings the total to 30; "Load more" should now be gone.
  await expect(ledgerTable.getByRole('row')).toHaveCount(31); // 30 data rows + 1 header row
  await expect(page.getByText('Showing all 30 payments.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});

const viewports = [768, 1024, 1440];
for (const width of viewports) {
  test(`viewport layout check at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText('DepositCraft: Layaway & Deposit Plans')).toBeVisible();
    await expect(page.getByText('Configured deposit & layaway plans')).toBeVisible();
    await expect(page.getByText('Checkout layaway simulator')).toBeVisible();
  });
}

test('German locale renders the translated page title', async ({ page }) => {
  await page.goto('./?lang=de');
  await expect(page.getByText('Ihre DepositCraft-Konfiguration wird geladen…')).toBeHidden();
  await expect(page.getByText('DepositCraft: Anzahlungs- & Ratenkaufpläne')).toBeVisible();
});

test('captures a screenshot of the main dashboard for the record', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'DepositCraft: Layaway & Deposit Plans' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/dashboard-main.png', fullPage: true });
});

test('design system typography is applied to every card and page title', async ({ page }) => {
  // A Wix Design System string prop (title/subtitle/label) given a React element
  // renders unstyled, so the browser falls back to a serif face. Catch that here.
  await page.goto('./');
  await page.waitForSelector('[data-hook="title"], h1, h2', { timeout: 15000 });
  const offenders = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-hook="title"], [data-hook="subtitle"]'));
    return nodes
      .map((el) => ({
        text: (el.textContent || '').trim().slice(0, 40),
        font: getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      }))
      .filter((n) => /^(Times|Times New Roman|serif|Georgia)$/i.test(n.font));
  });
  expect(offenders).toEqual([]);
});
