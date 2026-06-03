import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Activity redirect and detected source', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const eventsUrl = () => `/t/${tenantId}/s/${spaceId}/events`;
  const activityUrl = () => `/t/${tenantId}/s/${spaceId}/activity`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Redirect Org');
    spaceId = await createTestSpace(tenantId, 'Redirect Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('activity route redirects to events with source=detected', async () => {
    await page.goto(activityUrl(), { waitUntil: 'domcontentloaded' });

    // The guard redirects /activity -> /events?source=detected
    await page.waitForURL(`**${eventsUrl()}?source=detected`, { timeout: 10000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe(eventsUrl());
    expect(url.searchParams.get('source')).toBe('detected');

    // Verify the events page loads (topbar "New Event" button or the table)
    await expect(
      page.getByRole('button', { name: /new event/i }).or(page.locator('p-table'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('events page loads with source=detected filter pre-set', async () => {
    await page.goto(`${eventsUrl()}?source=detected`, { waitUntil: 'domcontentloaded' });

    // Wait for the page to render
    await expect(
      page.getByRole('button', { name: /new event/i }).or(page.locator('p-table'))
    ).toBeVisible({ timeout: 10000 });

    // The source column header should be present
    const sourceHeader = page.locator('th').filter({ hasText: 'Source' });
    await expect(sourceHeader).toBeVisible({ timeout: 5000 });

    // The grid state serializes the active source filter into the URL as
    // filter.source_type=detected (the grid's URL codec, not the raw
    // query param). Verify that the filter is active in the serialized URL.
    expect(page.url()).toContain('source_type=detected');
  });

  test('events page loads with all sources (no filter)', async () => {
    await page.goto(eventsUrl(), { waitUntil: 'domcontentloaded' });

    // Verify the page renders
    await expect(
      page.getByRole('button', { name: /new event/i }).or(page.locator('p-table'))
    ).toBeVisible({ timeout: 10000 });

    // Verify the source column filter exists in the table header
    const sourceHeader = page.locator('th').filter({ hasText: 'Source' });
    await expect(sourceHeader).toBeVisible({ timeout: 5000 });

    // The source column filter icon should be present (p-column-filter renders
    // a filter icon button inside the th)
    const sourceFilterIcon = sourceHeader.locator('p-column-filter');
    await expect(sourceFilterIcon).toBeAttached({ timeout: 5000 });

    // URL should NOT have source= query param
    const url = new URL(page.url());
    expect(url.searchParams.has('source')).toBe(false);
  });
});
