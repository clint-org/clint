import { test, expect } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { fillInput } from '../helpers/form.helper';

test.describe('Onboarding', () => {
  test.skip('new user with no tenants is redirected to /onboarding', async () => {
    // Skipped: cannot guarantee this test runs before tenants exist for the shared user
  });

  test('invalid invite code shows error message', async ({ browser }) => {
    const page = await authenticatedPage(browser);
    try {
      await page.goto('/onboarding', { waitUntil: 'networkidle' });

      await fillInput(page, '#invite-code', 'INVALID-CODE-123');
      await page.getByRole('button', { name: 'Join' }).click();

      await expect(page.locator('#invite-code-error')).toBeVisible({ timeout: 5000 });
    } finally {
      await page.close();
    }
  });
});
