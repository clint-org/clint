import { test, expect } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';

test.describe('Onboarding', () => {
  test('new user with no tenants is redirected to /onboarding', async ({ browser }) => {
    const page = await authenticatedPage(browser);
    try {
      await expect(page).toHaveURL(/\/onboarding/);
    } finally {
      await page.close();
    }
  });

  test('user can create a new organization', async ({ browser }) => {
    const page = await authenticatedPage(browser);
    try {
      await page.goto('/onboarding', { waitUntil: 'networkidle' });

      await page.getByLabel('Organization Name').fill('Test Organization');
      await page.getByRole('button', { name: 'Create Organization' }).click();

      await expect(page).toHaveURL(/\/t\/[^/]+\/spaces/, { timeout: 10000 });
    } finally {
      await page.close();
    }
  });

  test('invalid invite code shows error message', async ({ browser }) => {
    const page = await authenticatedPage(browser);
    try {
      await page.goto('/onboarding', { waitUntil: 'networkidle' });

      const joinTab = page.getByRole('tab', { name: /join with code/i });
      await joinTab.click();

      await page.getByRole('textbox').fill('INVALID-CODE-123');
      await page.getByRole('button', { name: /join organization/i }).click();

      const errorMessage = page.getByText(/error|invalid|not found/i);
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    } finally {
      await page.close();
    }
  });
});
