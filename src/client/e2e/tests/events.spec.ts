import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Events CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const eventsUrl = () => `/t/${tenantId}/s/${spaceId}/events`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Events Org');
    spaceId = await createTestSpace(tenantId, 'Events Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('events page loads', async () => {
    await page.goto(eventsUrl(), { waitUntil: 'networkidle' });
    // The page should have a button to create new events
    await expect(page.getByRole('button', { name: /new event/i })).toBeVisible({ timeout: 10000 });
  });

  test('create event via dialog', async () => {
    await page.getByRole('button', { name: /new event/i }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#event-title', 'Phase 3 Topline Results');

    await page.getByRole('button', { name: /create|save/i }).click();
    await page.waitForTimeout(3000);

    await page.goto(eventsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Phase 3 Topline Results')).toBeVisible({ timeout: 10000 });
  });

  test('delete event', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'Phase 3 Topline Results' });
    await row.locator('app-row-actions button').first().click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    await page.waitForTimeout(2000);

    await page.goto(eventsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Phase 3 Topline Results')).not.toBeVisible({ timeout: 5000 });
  });
});
