import { Page } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fillInput } from './form.helper';
import { getAuthStorage } from './auth.helper';

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
  // Create tenant via Supabase admin API for reliability
  const admin = getAdminClient();
  const auth = getAuthStorage();
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ name, slug })
    .select()
    .single();

  if (tenantError) throw new Error(`Failed to create tenant: ${tenantError.message}`);

  // Add user as owner
  const { error: memberError } = await admin
    .from('tenant_members')
    .insert({ tenant_id: tenant.id, user_id: auth.userId, role: 'owner' });

  if (memberError) throw new Error(`Failed to add tenant member: ${memberError.message}`);

  return tenant.id;
}

export async function createTestSpace(
  _page: Page,
  tenantId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();
  const auth = getAuthStorage();

  const { data: space, error: spaceError } = await admin
    .from('spaces')
    .insert({ tenant_id: tenantId, name, created_by: auth.userId })
    .select()
    .single();

  if (spaceError) throw new Error(`Failed to create space: ${spaceError.message}`);

  // Add user as space member
  const { error: memberError } = await admin
    .from('space_members')
    .insert({ space_id: space.id, user_id: auth.userId, role: 'owner' });

  if (memberError) throw new Error(`Failed to add space member: ${memberError.message}`);

  return space.id;
}

export async function navigateToSpace(
  page: Page,
  tenantId: string,
  spaceId: string,
): Promise<void> {
  await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });
}
