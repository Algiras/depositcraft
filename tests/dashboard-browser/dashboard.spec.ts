import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.log('HARNESS_PAGE_ERROR', error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('HARNESS_CONSOLE_ERROR', msg.text()); });
  await page.goto('./');
  await expect(page.getByText('Loading your DepositCraft configuration…')).toBeHidden();
});

test('dashboard renders header, KPI cards, table with plans, and simulator', async ({ page }) => {
  await expect(page.getByText('DepositCraft: Layaway & Deposit Plans')).toBeVisible();
  await expect(page.getByRole('table').getByText('Luxury Furniture Layaway Plan')).toBeVisible();
  await expect(page.getByText('Checkout payment breakdown')).toBeVisible();
  await expect(page.getByText('Deposit due today (at checkout):')).toBeVisible();
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

test('actionable recovery UI renders when storage is provisioning and recovers on retry', async ({ page }) => {
  await page.goto('./?storage=fail');
  await expect(page.getByText('still provisioning private storage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();

  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText('still provisioning private storage')).toBeHidden();
  await expect(page.getByRole('button', { name: '+ Create deposit plan' })).toBeEnabled();
  await expect(page.getByRole('table').getByText('Luxury Furniture Layaway Plan')).toBeVisible();
});

test('interactive simulator updates deposit calculation on cart subtotal change', async ({ page }) => {
  const subtotalInput = page.getByLabel('Simulated cart subtotal (USD)');
  await subtotalInput.fill('2000.00');
  await expect(page.getByRole('heading', { name: '$500.00' })).toBeVisible();
});

test('modal opens and cancels cleanly', async ({ page }) => {
  await page.getByRole('button', { name: '+ Create deposit plan' }).click();
  await expect(page.getByRole('heading', { name: 'Create deposit & layaway plan' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Create deposit & layaway plan' })).toBeHidden();
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
