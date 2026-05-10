import { Page } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

function getUserId(): string {
  return getAuthStorage().userId;
}

export async function createTestTenant(name: string): Promise<string> {
  const admin = getAdminClient();
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();

  const { data, error } = await admin
    .from('tenants')
    .insert({ name, slug })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create tenant: ${error.message}`);

  await admin
    .from('tenant_members')
    .insert({ tenant_id: data.id, user_id: getUserId(), role: 'owner' });

  return data.id;
}

/**
 * Creates an agency, links the test user as an agency owner, and (optionally)
 * attaches an existing tenant to that agency. Required for tests that exercise
 * primary_intelligence write RPCs, which check is_agency_member_of_space().
 */
export async function createTestAgency(
  name: string,
  opts?: { tenantId?: string },
): Promise<string> {
  const admin = getAdminClient();
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const slug =
    name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + stamp;
  const subdomain = ('a' + slug).slice(0, 60);

  const { data, error } = await admin
    .from('agencies')
    .insert({
      name,
      slug,
      subdomain,
      app_display_name: name,
      contact_email: `agency-${stamp}@clint.local`,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create agency: ${error.message}`);

  const { error: memberError } = await admin
    .from('agency_members')
    .insert({ agency_id: data.id, user_id: getUserId(), role: 'owner' });
  if (memberError) throw new Error(`Failed to add agency member: ${memberError.message}`);

  if (opts?.tenantId) {
    const { error: linkError } = await admin
      .from('tenants')
      .update({ agency_id: data.id })
      .eq('id', opts.tenantId);
    if (linkError) throw new Error(`Failed to link tenant to agency: ${linkError.message}`);
  }

  return data.id;
}

export async function createTestSpace(tenantId: string, name: string): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('spaces')
    .insert({ tenant_id: tenantId, name, created_by: getUserId() })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create space: ${error.message}`);

  await admin
    .from('space_members')
    .insert({ space_id: data.id, user_id: getUserId(), role: 'owner' });

  return data.id;
}

export async function createTestCompany(
  spaceId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('companies')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create company: ${error.message}`);

  return data.id;
}

export async function createTestProduct(
  spaceId: string,
  companyId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('products')
    .insert({ space_id: spaceId, created_by: getUserId(), company_id: companyId, name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create product: ${error.message}`);

  return data.id;
}

export async function createTestTherapeuticArea(
  spaceId: string,
  name: string,
  abbreviation?: string,
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('therapeutic_areas')
    .insert({ space_id: spaceId, created_by: getUserId(), name, abbreviation })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create therapeutic area: ${error.message}`);

  return data.id;
}

export async function createTestTrial(
  spaceId: string,
  productId: string,
  therapeuticAreaId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('trials')
    .insert({
      space_id: spaceId,
      created_by: getUserId(),
      product_id: productId,
      therapeutic_area_id: therapeuticAreaId,
      name,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create trial: ${error.message}`);

  return data.id;
}

/**
 * Update a trial's phase data directly on the trials table.
 * The trial_phases table was dropped in the marker_system_redesign migration;
 * phase data now lives as columns on the trials table.
 *
 * This updates the trial with the given phase_type, phase_start_date, and
 * optional phase_end_date. If the trial already has phase data and you want
 * to simulate the "latest" phase, call this again -- it overwrites.
 */
export async function createTestTrialPhase(
  _spaceId: string,
  trialId: string,
  phaseType: string,
  startDate: string,
  endDate?: string,
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('trials')
    .update({
      phase_type: phaseType,
      phase_start_date: startDate,
      phase_end_date: endDate ?? null,
    })
    .eq('id', trialId)
    .select('id')
    .single();
  if (error) throw new Error(`Failed to update trial phase: ${error.message}`);

  return data.id;
}

export async function createTestMarkerType(
  spaceId: string,
  name: string,
  categoryId: string,
  opts?: { shape?: string; fill_style?: string; color?: string },
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('marker_types')
    .insert({
      space_id: spaceId,
      created_by: getUserId(),
      name,
      category_id: categoryId,
      shape: opts?.shape || 'circle',
      fill_style: opts?.fill_style || 'filled',
      color: opts?.color || '#14b8a6',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create marker type: ${error.message}`);

  return data.id;
}

export async function getSystemMarkerCategoryId(name: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('marker_categories')
    .select('id')
    .eq('name', name)
    .eq('is_system', true)
    .single();
  if (error) throw new Error(`System marker category "${name}" not found: ${error.message}`);
  return data.id;
}

export async function createTestMoa(
  spaceId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('mechanisms_of_action')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create MOA: ${error.message}`);
  return data.id;
}

export async function createTestRoa(
  spaceId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('routes_of_administration')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create ROA: ${error.message}`);
  return data.id;
}

export async function navigateToSpace(
  page: Page,
  tenantId: string,
  spaceId: string,
): Promise<void> {
  await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });
}
