import { Page } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

export async function createTestTenant(page: Page, name: string): Promise<string> {
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await page.getByLabel('Organization Name').fill(name);
  await page.getByRole('button', { name: 'Create Organization' }).click();

  await page.waitForURL(/\/t\/[^/]+\/spaces/);

  const match = page.url().match(/\/t\/([^/]+)\//);
  if (!match) throw new Error('Failed to extract tenantId from URL after tenant creation');
  return match[1];
}

export async function createTestSpace(
  page: Page,
  tenantId: string,
  name: string,
): Promise<string> {
  await page.goto(`/t/${tenantId}/spaces`, { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: /create/i }).click();

  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: /create/i }).last().click();

  await page.waitForURL(/\/t\/[^/]+\/s\/[^/]+/, { timeout: 10000 }).catch(() => {
    // Space might appear in the list without redirecting
  });

  if (page.url().includes('/spaces')) {
    await page.getByText(name).click();
    await page.waitForURL(/\/t\/[^/]+\/s\/[^/]+/);
  }

  const match = page.url().match(/\/s\/([^/]+)/);
  if (!match) throw new Error('Failed to extract spaceId from URL after space creation');
  return match[1];
}

export async function navigateToSpace(
  page: Page,
  tenantId: string,
  spaceId: string,
): Promise<void> {
  await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });
}
