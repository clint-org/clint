import { test, expect, Page } from '@playwright/test';
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
      const signOutButton = page.getByRole('button', { name: /sign out/i });
      await signOutButton.click();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await page.close();
    }
  });
});
