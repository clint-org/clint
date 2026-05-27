import { test, expect } from '../fixtures';

const BASE = 'https://bi.dev.clintapp.com';
const TENANT_ID = '02cbe930-7f17-46c4-942b-bc854b625cee';

test.describe('POC: App loads and navigation works', () => {
  test('spaces page loads with both spaces visible', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/spaces`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Obesity Test')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No Data Test')).toBeVisible();

    await page.screenshot({ path: 'e2e/persona/reports/01-spaces-page.png', fullPage: true });
  });

  test('navigate into Obesity Test space and see data', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/spaces`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Obesity Test')).toBeVisible({ timeout: 30_000 });
    await page.getByText('Obesity Test').click();

    await page.waitForURL(/\/s\//, { timeout: 15_000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/persona/reports/02-obesity-space-landing.png', fullPage: true });
  });

  test('navigate into No Data Test space and see empty state', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/spaces`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No Data Test')).toBeVisible({ timeout: 30_000 });
    await page.getByText('No Data Test').click();

    await page.waitForURL(/\/s\//, { timeout: 15_000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/persona/reports/03-empty-space-landing.png', fullPage: true });
  });

  test('sidebar navigation items are visible in Obesity Test space', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/spaces`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Obesity Test')).toBeVisible({ timeout: 30_000 });
    await page.getByText('Obesity Test').click();
    await page.waitForURL(/\/s\//, { timeout: 15_000 });

    const sidebar = page.locator('app-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'e2e/persona/reports/04-sidebar-visible.png', fullPage: true });
  });
});
