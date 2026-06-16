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
  const slug =
    name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '') +
    '-' +
    Date.now();

  const { data, error } = await admin.from('tenants').insert({ name, slug }).select('id').single();
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
  opts?: { tenantId?: string }
): Promise<string> {
  const admin = getAdminClient();
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const slug =
    name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '') +
    '-' +
    stamp;
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

export async function createTestCompany(spaceId: string, name: string): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('companies')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create company: ${error.message}`);

  return data.id;
}

export async function createTestAsset(
  spaceId: string,
  companyId: string,
  name: string
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('assets')
    .insert({ space_id: spaceId, created_by: getUserId(), company_id: companyId, name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create asset: ${error.message}`);

  return data.id;
}

/** @deprecated Use createTestAsset instead */
export const createTestProduct = createTestAsset;

export async function createTestIndication(
  spaceId: string,
  name: string,
  abbreviation?: string
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('indications')
    .insert({ space_id: spaceId, created_by: getUserId(), name, abbreviation })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create indication: ${error.message}`);

  return data.id;
}

/** @deprecated Use createTestIndication instead */
export const createTestTherapeuticArea = createTestIndication;

export async function createTestTrial(
  spaceId: string,
  assetId: string,
  indicationId: string,
  name: string
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('trials')
    .insert({
      space_id: spaceId,
      created_by: getUserId(),
      asset_id: assetId,
      name,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create trial: ${error.message}`);

  // Link the trial to the indication via the condition chain:
  // condition -> condition_indication_map -> trial_conditions
  // Also ensure an asset_indications row exists (required for the bullseye
  // and dashboard RPCs to include this asset/indication pair).
  if (indicationId) {
    await linkTrialToIndication(spaceId, data.id, indicationId);
    await ensureAssetIndication(spaceId, assetId, indicationId);
  }

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
  endDate?: string
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
  opts?: { shape?: string; fill_style?: string; color?: string }
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

export async function createTestMoa(spaceId: string, name: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('mechanisms_of_action')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create MOA: ${error.message}`);
  return data.id;
}

export async function createTestRoa(spaceId: string, name: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('routes_of_administration')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create ROA: ${error.message}`);
  return data.id;
}

/**
 * Create or update an asset_indications row, which sets the development_status
 * (ring position) for an asset in a given indication. Uses upsert so it is
 * safe to call even if ensureAssetIndication already created a default row.
 */
export async function createTestAssetIndication(
  spaceId: string,
  assetId: string,
  indicationId: string,
  status: string
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('asset_indications')
    .upsert(
      {
        space_id: spaceId,
        asset_id: assetId,
        indication_id: indicationId,
        development_status: status,
        development_status_source: 'analyst',
        created_by: getUserId(),
      },
      { onConflict: 'asset_id,indication_id' }
    )
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create asset indication: ${error.message}`);
  return data.id;
}

/**
 * Link a trial to an indication via the condition chain:
 * 1. Find or create a condition for the indication
 * 2. Link condition to indication via condition_indication_map
 * 3. Link trial to condition via trial_conditions
 */
async function linkTrialToIndication(
  spaceId: string,
  trialId: string,
  indicationId: string
): Promise<void> {
  const admin = getAdminClient();

  // Get the indication name to create/find a matching condition
  const { data: indication, error: indError } = await admin
    .from('indications')
    .select('name')
    .eq('id', indicationId)
    .single();
  if (indError) throw new Error(`Failed to get indication: ${indError.message}`);

  // Find or create a condition with the same name
  const conditionName = indication.name;
  let conditionId: string;

  const { data: existingCondition } = await admin
    .from('conditions')
    .select('id')
    .eq('space_id', spaceId)
    .eq('name', conditionName)
    .maybeSingle();

  if (existingCondition) {
    conditionId = existingCondition.id;
  } else {
    const { data: newCondition, error: condError } = await admin
      .from('conditions')
      .insert({ space_id: spaceId, name: conditionName, source: 'analyst' })
      .select('id')
      .single();
    if (condError) throw new Error(`Failed to create condition: ${condError.message}`);
    conditionId = newCondition.id;
  }

  // Link condition to indication (upsert-style: ignore if exists)
  await admin
    .from('condition_indication_map')
    .upsert({ condition_id: conditionId, indication_id: indicationId }, {
      onConflict: 'condition_id,indication_id',
    });

  // Link trial to condition
  const { error: tcError } = await admin
    .from('trial_conditions')
    .upsert({ trial_id: trialId, condition_id: conditionId }, {
      onConflict: 'trial_id,condition_id',
    });
  if (tcError) throw new Error(`Failed to link trial to condition: ${tcError.message}`);
}

/**
 * Ensure an asset_indications row exists for the given asset + indication.
 * If one already exists, this is a no-op. Otherwise, creates one with
 * development_status = 'P3' (a sensible default). Tests that need a
 * different status should call createTestAssetIndication explicitly.
 */
async function ensureAssetIndication(
  spaceId: string,
  assetId: string,
  indicationId: string
): Promise<void> {
  const admin = getAdminClient();
  const { data: existing } = await admin
    .from('asset_indications')
    .select('id')
    .eq('asset_id', assetId)
    .eq('indication_id', indicationId)
    .maybeSingle();

  if (!existing) {
    const { error } = await admin
      .from('asset_indications')
      .insert({
        space_id: spaceId,
        asset_id: assetId,
        indication_id: indicationId,
        development_status: 'P3',
        development_status_source: 'analyst',
        created_by: getUserId(),
      });
    if (error) throw new Error(`Failed to create asset indication: ${error.message}`);
  }
}

export async function navigateToSpace(
  page: Page,
  tenantId: string,
  spaceId: string
): Promise<void> {
  await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'domcontentloaded' });
}

/** Link an asset to a mechanism of action (asset_mechanisms_of_action join row). */
export async function linkAssetMoa(assetId: string, moaId: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from('asset_mechanisms_of_action')
    .insert({ asset_id: assetId, moa_id: moaId });
  if (error) throw new Error(`Failed to link asset MOA: ${error.message}`);
}

/** Link an asset to a route of administration (asset_routes_of_administration join row). */
export async function linkAssetRoa(assetId: string, roaId: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from('asset_routes_of_administration')
    .insert({ asset_id: assetId, roa_id: roaId });
  if (error) throw new Error(`Failed to link asset ROA: ${error.message}`);
}

/**
 * Create a marker (optionally assigned to a trial). Catalysts are markers with
 * a future event_date, so tests seed those by passing a future date here.
 */
export async function createTestMarker(
  spaceId: string,
  markerTypeId: string,
  title: string,
  eventDate: string,
  opts?: {
    trialId?: string;
    projection?: string;
    description?: string;
    sourceUrl?: string;
  }
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('markers')
    .insert({
      space_id: spaceId,
      created_by: getUserId(),
      marker_type_id: markerTypeId,
      title,
      event_date: eventDate,
      projection: opts?.projection ?? 'actual',
      description: opts?.description ?? null,
      source_url: opts?.sourceUrl ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create marker: ${error.message}`);

  if (opts?.trialId) {
    const { error: aErr } = await admin
      .from('marker_assignments')
      .insert({ marker_id: data.id, trial_id: opts.trialId });
    if (aErr) throw new Error(`Failed to assign marker: ${aErr.message}`);
  }

  return data.id;
}

/** Create an analyst event row. Category is looked up by name (system seed data). */
export async function createTestEvent(
  spaceId: string,
  title: string,
  eventDate: string,
  opts?: {
    categoryName?: string;
    priority?: 'high' | 'low';
    companyId?: string;
    assetId?: string;
    trialId?: string;
    description?: string;
    tags?: string[];
  }
): Promise<string> {
  const admin = getAdminClient();
  const { data: cat, error: catErr } = await admin
    .from('event_categories')
    .select('id')
    .eq('name', opts?.categoryName ?? 'Clinical')
    .single();
  if (catErr) throw new Error(`Event category lookup failed: ${catErr.message}`);

  const { data, error } = await admin
    .from('events')
    .insert({
      space_id: spaceId,
      created_by: getUserId(),
      category_id: cat.id,
      title,
      event_date: eventDate,
      priority: opts?.priority ?? 'low',
      company_id: opts?.companyId ?? null,
      asset_id: opts?.assetId ?? null,
      trial_id: opts?.trialId ?? null,
      description: opts?.description ?? null,
      tags: opts?.tags ?? [],
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create event: ${error.message}`);
  return data.id;
}
