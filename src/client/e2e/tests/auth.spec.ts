import { test, expect } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';

test.describe('Authentication', () => {
  test('unauthenticated user visiting / is redirected to /login', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
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

  test('sign out clears session and redirects to /login', async ({ browser }) => {
    const page = await authenticatedPage(browser);
    try {
      await page.waitForSelector('button:has-text("Sign out")', { timeout: 10000 });
      await page.click('button:has-text("Sign out")');
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    } finally {
      await page.close();
    }
  });
});
