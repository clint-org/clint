import { test, expect } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';

test.describe('Authentication', () => {
  test('unauthenticated user visiting a protected route is redirected to /login', async ({
    page,
  }) => {
    // The marketing landing now serves "/" on the default host, so "/" no
    // longer redirects unauth users. Visit a route gated by authGuard
    // (/onboarding) to assert the auth-required redirect still fires.
    await page.goto('/onboarding', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page renders with Google sign-in button', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const signInButton = page.getByRole('button', { name: /sign in with google/i });
    await expect(signInButton).toBeVisible();
  });

  test('authenticated user can access protected routes', async ({ browser }) => {
    const page = await authenticatedPage(browser);
    try {
      await expect(page).not.toHaveURL(/\/login/);
    } finally {
      await page.close();
    }
  });

  test.skip('sign out clears session and redirects to /login', async ({ browser }) => {
    const tenantId = await createTestTenant('Sign Out Org');
    const spaceId = await createTestSpace(tenantId, 'Sign Out Space');

    const page = await authenticatedPage(browser);
    try {
      await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });
      await page.locator('button:text("Sign out")').waitFor({ timeout: 10000 });
      await page.locator('button:text("Sign out")').click();
      await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    } finally {
      await page.close();
    }
  });
});
