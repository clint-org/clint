/**
 * ctgov-marker-precision-over-time.spec.ts
 *
 * End-to-end integration proof for the CT.gov trial dates + marker precision
 * change (migration 20260626120000_ctgov_trial_dates_markers.sql).
 *
 * All assertions go through the live `ingest_ctgov_snapshot` RPC and the real
 * DB, pinning SQL resolver output to the TS `precisionMidpointISO` source of
 * truth.
 *
 * Prerequisite: run `supabase db reset` before this suite to apply the branch
 * migration and set SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env`.
 *
 * Run in isolation:
 *   npm run test:integration -- ctgov-marker-precision-over-time
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { createScratchAgency } from '../fixtures/scratch';
import { as } from '../harness/as';
import { precisionMidpointISO } from '../../src/app/core/models/marker-date-precision';
import {
  deriveTrialPhaseSpan,
  TRIAL_START_MARKER_TYPE_ID,
  PCD_MARKER_TYPE_ID,
  TRIAL_END_MARKER_TYPE_ID,
} from '../../src/app/core/models/trial-phase-span';

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const CTGOV_SECRET = 'local-dev-ctgov-secret';

/** Generate a short NCT-style ID that fits within the varchar(20) column. */
function shortNct(): string {
  // 8 hex chars from UUID, prefixed with 'T' = 9 chars total, well under 20.
  return `T${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Run a SQL query via pg and return rows. */
async function pgQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = new PgClient({ connectionString: SUPABASE_DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query(sql, params);
    return rows as T[];
  } finally {
    await client.end();
  }
}

/**
 * Delete all markers for an agency's spaces with the ctgov_seeding GUC set,
 * then cascade delete the rest (spaces -> tenants -> agency).
 * This bypasses the BEFORE DELETE marker lock trigger that fires even for
 * the superuser/service role, matching the teardown pattern from the
 * migration smoke (set_config + delete in the same transaction).
 */
async function cleanupAgencyWithGucBypass(agencyId: string): Promise<void> {
  const client = new PgClient({ connectionString: SUPABASE_DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Set GUC before the DELETE so the lock trigger sees ctgov_seeding = 'on'.
    await client.query(`select set_config('clint.ctgov_seeding', 'on', true)`);
    await client.query(
      `delete from public.markers where space_id in (
         select s.id from public.spaces s
         join public.tenants t on s.tenant_id = t.id
         where t.agency_id = $1
       )`,
      [agencyId]
    );
    await client.query(`select set_config('clint.ctgov_seeding', 'off', true)`);
    await client.query('COMMIT');

    // Cascade rest outside the GUC transaction (no markers remain to fire on)
    await client.query(
      `delete from public.spaces where tenant_id in
         (select id from public.tenants where agency_id = $1)`,
      [agencyId]
    );
    await client.query(`delete from public.tenants where agency_id = $1`, [agencyId]);
    await client.query(`delete from public.agencies where id = $1`, [agencyId]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

/** Call ingest_ctgov_snapshot via the service-role client. */
async function ingest(
  svc: SupabaseClient,
  trialId: string,
  spaceId: string,
  nctId: string,
  version: number,
  postDate: string,
  payload: object
): Promise<void> {
  const { error } = await svc.rpc('ingest_ctgov_snapshot', {
    p_secret: CTGOV_SECRET,
    p_trial_id: trialId,
    p_space_id: spaceId,
    p_nct_id: nctId,
    p_version: version,
    p_post_date: postDate,
    p_payload: payload,
    p_fetched_via: 'manual_sync',
    p_module_hints: null,
  });
  if (error) throw new Error(`ingest_ctgov_snapshot v${version}: ${error.message}`);
}

interface MarkerRow {
  id: string;
  event_date: string;
  date_precision: string;
  projection: string;
  metadata: Record<string, unknown>;
}

/** Query all markers of a given type assigned to a trial. */
async function queryMarkers(trialId: string, markerTypeId: string): Promise<MarkerRow[]> {
  return pgQuery<MarkerRow>(
    `select m.id, m.event_date::text, m.date_precision, m.projection, m.metadata
       from public.marker_assignments ma
       join public.markers m on m.id = ma.marker_id
      where ma.trial_id = $1 and m.marker_type_id = $2`,
    [trialId, markerTypeId]
  );
}

interface EventRow {
  id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
}

/** Query trial_change_events of a given type for a trial. */
async function queryEvents(trialId: string, eventType: string): Promise<EventRow[]> {
  return pgQuery<EventRow>(
    `select id, event_type, source, payload
       from public.trial_change_events
      where trial_id = $1 and event_type = $2`,
    [trialId, eventType]
  );
}

/** Insert a trial directly via service-role (bypasses RLS; created_by must be valid auth.users). */
async function insertTrial(
  svc: SupabaseClient,
  spaceId: string,
  assetId: string,
  name: string,
  createdBy: string,
  identifier?: string
): Promise<string> {
  const row: Record<string, unknown> = {
    space_id: spaceId,
    asset_id: assetId,
    name,
    created_by: createdBy,
  };
  if (identifier !== undefined) row['identifier'] = identifier;
  const { data, error } = await svc.from('trials').insert(row).select('id').single();
  if (error) throw new Error(`insert trial "${name}": ${error.message}`);
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// get_dashboard_data response shapes (only the fields this spec reads)
// ---------------------------------------------------------------------------

interface DashboardMarker {
  id: string;
  event_date: string | null;
  date_precision: string;
  marker_type: { id: string } | null;
}

interface DashboardTrial {
  id: string;
  markers: DashboardMarker[];
}

interface DashboardIndication {
  trials: DashboardTrial[];
}

interface DashboardAsset {
  indications: DashboardIndication[];
}

interface DashboardCompany {
  assets: DashboardAsset[];
}

/** Find a trial (with its markers) in the nested get_dashboard_data response. */
function findTrialInDashboard(
  companies: DashboardCompany[],
  trialId: string
): DashboardTrial | null {
  for (const company of companies ?? []) {
    for (const asset of company.assets ?? []) {
      for (const ind of asset.indications ?? []) {
        for (const trial of ind.trials ?? []) {
          if (trial.id === trialId) return trial;
        }
      }
    }
  }
  return null;
}

/** Map dashboard markers to the PhaseSpanMarker shape deriveTrialPhaseSpan expects. */
function dashboardMarkersToSpanInput(
  markers: DashboardMarker[]
): { marker_type_id: string; event_date: string | null; date_precision: 'exact' | 'month' | 'quarter' | 'half' | 'year' }[] {
  return markers.map((m) => ({
    marker_type_id: m.marker_type?.id ?? '',
    event_date: m.event_date,
    date_precision: m.date_precision as 'exact' | 'month' | 'quarter' | 'half' | 'year',
  }));
}

// ---------------------------------------------------------------------------
// Shared top-level personas and service-role client
// ---------------------------------------------------------------------------

let p: Personas;
let svc: SupabaseClient;

beforeAll(async () => {
  // Preamble: remove any ctgov-owned markers left by a prior failed test run.
  // buildPersonas() wipes pftest-tx-* agencies by cascading agency -> space ->
  // markers, but the BEFORE DELETE trigger raises for ctgov-owned markers unless
  // the GUC is set first. This step sets the GUC in the same transaction as the
  // marker delete so the trigger allows it, matching the migration smoke teardown.
  {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query(`select set_config('clint.ctgov_seeding', 'on', true)`);
      await pg.query(`
        delete from public.markers
         where space_id in (
           select s.id from public.spaces s
           join public.tenants t on s.tenant_id = t.id
           join public.agencies a on a.id = t.agency_id
           where a.subdomain like 'pftest-tx-%'
         )
      `);
      await pg.query(`select set_config('clint.ctgov_seeding', 'off', true)`);
      await pg.query('COMMIT');
    } catch (_err) {
      await pg.query('ROLLBACK').catch(() => undefined);
      // Non-fatal: if nothing was left, proceed.
    } finally {
      await pg.end();
    }
  }

  p = await buildPersonas();
  svc = adminClient();
}, 120_000);

// ---------------------------------------------------------------------------
// Groups 1 / 3 / 4: precision-over-time + date slip event + lock
// Uses one scratch space and trial_A (NCT unique per run).
// ALL syncs happen in beforeAll; state is captured into variables.
// ---------------------------------------------------------------------------

describe('precision over time, date slip event, and ct.gov marker lock', () => {
  let agencyId: string;
  let spaceId: string;
  let trialAId: string;
  let nctA: string;

  // Captured per-version state for group 1 assertions
  let markerV1: MarkerRow;
  let markerV2: MarkerRow;
  let markerV3: MarkerRow;
  let markerIdAfterV1: string;

  // Captured state for group 4 (lock) assertions
  let lockThrew: boolean;
  let markerValueAfterLockAttempt: string;
  let markerValueAfterV4: string;

  beforeAll(async () => {
    const scratch = await createScratchAgency(p);
    spaceId = scratch.spaceId;
    agencyId = scratch.agencyId;
    const createdBy = p.ids.platform_admin;

    const { data: co, error: coErr } = await svc
      .from('companies')
      .insert({ space_id: spaceId, name: 'Prec Co', created_by: createdBy })
      .select('id')
      .single();
    if (coErr) throw new Error(`insert company: ${coErr.message}`);

    const { data: asset, error: aErr } = await svc
      .from('assets')
      .insert({
        space_id: spaceId,
        company_id: (co as { id: string }).id,
        name: 'Prec Drug',
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (aErr) throw new Error(`insert asset: ${aErr.message}`);

    nctA = shortNct();
    trialAId = await insertTrial(svc, spaceId, (asset as { id: string }).id, 'Prec Trial A', createdBy, nctA);

    // ---- v1: year-precision ANTICIPATED ----
    await ingest(svc, trialAId, spaceId, nctA, 1, '2026-01-01', {
      protocolSection: {
        statusModule: { startDateStruct: { date: '2026', type: 'ANTICIPATED' } },
      },
    });

    const v1Markers = await queryMarkers(trialAId, TRIAL_START_MARKER_TYPE_ID);
    if (v1Markers.length !== 1) throw new Error(`Expected 1 Trial Start after v1, got ${v1Markers.length}`);
    markerV1 = v1Markers[0]!;
    markerIdAfterV1 = markerV1.id;

    // ---- v2: month-precision ANTICIPATED ----
    await ingest(svc, trialAId, spaceId, nctA, 2, '2026-02-01', {
      protocolSection: {
        statusModule: { startDateStruct: { date: '2026-11', type: 'ANTICIPATED' } },
      },
    });

    const v2Markers = await queryMarkers(trialAId, TRIAL_START_MARKER_TYPE_ID);
    if (v2Markers.length !== 1) throw new Error(`Expected 1 Trial Start after v2, got ${v2Markers.length}`);
    markerV2 = v2Markers[0]!;

    // ---- v3: exact ACTUAL ----
    await ingest(svc, trialAId, spaceId, nctA, 3, '2026-03-01', {
      protocolSection: {
        statusModule: { startDateStruct: { date: '2026-11-03', type: 'ACTUAL' } },
      },
    });

    const v3Markers = await queryMarkers(trialAId, TRIAL_START_MARKER_TYPE_ID);
    if (v3Markers.length !== 1) throw new Error(`Expected 1 Trial Start after v3, got ${v3Markers.length}`);
    markerV3 = v3Markers[0]!;

    // ---- Group 4 setup: lock test ----
    // Attempt a direct analyst update of the ctgov-owned marker.
    // The BEFORE UPDATE trigger (trg_guard_ctgov_locked_markers) raises P0001
    // regardless of Postgres role (triggers are not bypassed by service role).
    lockThrew = false;
    try {
      await pgQuery(
        `update public.markers set event_date = '2030-01-01' where id = $1`,
        [markerV3.id]
      );
    } catch (_err) {
      // Any error on this update counts as the lock having fired.
      lockThrew = true;
    }

    const [afterAttempt] = await pgQuery<{ event_date: string }>(
      `select event_date::text from public.markers where id = $1`,
      [markerV3.id]
    );
    markerValueAfterLockAttempt = afterAttempt?.event_date ?? '';

    // v4: ct.gov sync STILL updates the locked marker (ct.gov retains ownership)
    await ingest(svc, trialAId, spaceId, nctA, 4, '2026-04-01', {
      protocolSection: {
        statusModule: { startDateStruct: { date: '2027-01-15', type: 'ACTUAL' } },
      },
    });

    const [afterV4] = await pgQuery<{ event_date: string }>(
      `select event_date::text from public.markers where id = $1`,
      [markerV3.id]
    );
    markerValueAfterV4 = afterV4?.event_date ?? '';
  }, 120_000);

  afterAll(async () => {
    if (agencyId) await cleanupAgencyWithGucBypass(agencyId);
  });

  // --- Group 1: precision and projection evolve over CT.gov versions ---

  describe('group 1: precision and projection evolve over CT.gov versions', () => {
    it('v1 year-precision: exactly one Trial Start created after first sync', () => {
      expect(markerV1).toBeDefined();
    });

    it('v1 year-precision: event_date matches precisionMidpointISO (SQL/TS drift pin)', () => {
      // This is the key drift pin: the SQL midpoint for 'year' must equal the TS function.
      expect(markerV1.event_date).toBe(precisionMidpointISO('year', 2026, 1)); // '2026-07-01'
    });

    it('v1 year-precision: date_precision is year, projection is company', () => {
      expect(markerV1.date_precision).toBe('year');
      expect(markerV1.projection).toBe('company');
    });

    it('v1 marker has metadata.source === ctgov', () => {
      expect(markerV1.metadata?.['source']).toBe('ctgov');
    });

    it('v2 month-precision: SAME marker ID (UPSERT, not INSERT)', () => {
      expect(markerV2.id).toBe(markerIdAfterV1);
    });

    it('v2 month-precision: event_date updated to precisionMidpointISO month (SQL/TS drift pin)', () => {
      expect(markerV2.event_date).toBe(precisionMidpointISO('month', 2026, 11)); // '2026-11-15'
    });

    it('v2 month-precision: date_precision is month, projection still company', () => {
      expect(markerV2.date_precision).toBe('month');
      expect(markerV2.projection).toBe('company');
    });

    it('v3 exact ACTUAL: SAME marker ID (still UPSERT)', () => {
      expect(markerV3.id).toBe(markerIdAfterV1);
    });

    it('v3 exact ACTUAL: event_date stored verbatim (no midpoint)', () => {
      expect(markerV3.event_date).toBe('2026-11-03');
    });

    it('v3 exact ACTUAL: date_precision is exact, projection flips to actual', () => {
      expect(markerV3.date_precision).toBe('exact');
      expect(markerV3.projection).toBe('actual'); // ANTICIPATED -> ACTUAL flips projection
    });
  });

  // --- Group 2 (inline): exactly one Trial Start per trial after N syncs ---

  describe('group 2 (inline): exactly one Trial Start after multiple syncs', () => {
    it('exactly one Trial Start marker exists after v1 through v4 syncs', async () => {
      const markers = await queryMarkers(trialAId, TRIAL_START_MARKER_TYPE_ID);
      expect(markers).toHaveLength(1);
    });
  });

  // --- Group 3: date slip emits exactly one date_moved event, sourced ctgov ---

  describe('group 3: date slip emits date_moved events sourced ctgov only', () => {
    it('date_moved events exist after date changes between versions', async () => {
      const events = await queryEvents(trialAId, 'date_moved');
      // v1 is the first insert (marker_added only, no prior snapshot to diff against).
      // v2/v3/v4 each changed the date -> 3 date_moved events.
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('all date_moved events have source === ctgov (not analyst)', async () => {
      const events = await queryEvents(trialAId, 'date_moved');
      for (const ev of events) {
        expect(ev.source).toBe('ctgov');
      }
    });

    it('no duplicate date_moved events per sync (single emitter, spec A3)', async () => {
      // Before this fix: ingest emitted date_moved TWICE per date change
      // (once from _classify_change + once from the marker UPSERT trigger).
      // After the fix: _classify_change is suppressed for the three date fields;
      // only the marker audit fires (one per sync that changes the date).
      // v2 changed date: expect exactly 1 date_moved for that transition.
      // v3 changed date: expect exactly 1 more. v4 changed: 1 more. Total: 3.
      const events = await queryEvents(trialAId, 'date_moved');
      expect(events).toHaveLength(3);
    });
  });

  // --- Group 4: ct.gov marker lock ---

  describe('group 4: ct.gov marker lock rejects analyst edit; ct.gov sync still updates', () => {
    it('direct update of ctgov-owned marker raises (BEFORE UPDATE trigger)', () => {
      expect(lockThrew).toBe(true);
    });

    it('marker event_date is unchanged after rejected analyst update', () => {
      // The lock rejected the update; value must remain at v3 = '2026-11-03'
      expect(markerValueAfterLockAttempt).toBe('2026-11-03');
    });

    it('subsequent ingest_ctgov_snapshot still updates the locked marker', () => {
      // ct.gov retains ownership: the GUC bypasses the trigger during ingest.
      expect(markerValueAfterV4).toBe('2027-01-15');
    });
  });
});

// ---------------------------------------------------------------------------
// Group 2 (full set): exactly one of each marker type (Trial Start / PCD / Trial End)
// after N syncs. Uses a separate scratch space.
// ---------------------------------------------------------------------------

describe('group 2: exactly one Trial Start, PCD, and Trial End after N syncs', () => {
  let agencyId: string;
  let spaceId: string;
  let trialBId: string;
  let nctB: string;

  beforeAll(async () => {
    const scratch = await createScratchAgency(p);
    spaceId = scratch.spaceId;
    agencyId = scratch.agencyId;
    const createdBy = p.ids.platform_admin;

    const { data: co, error: coErr } = await svc
      .from('companies')
      .insert({ space_id: spaceId, name: 'Types Co', created_by: createdBy })
      .select('id')
      .single();
    if (coErr) throw new Error(`insert company: ${coErr.message}`);

    const { data: asset, error: aErr } = await svc
      .from('assets')
      .insert({
        space_id: spaceId,
        company_id: (co as { id: string }).id,
        name: 'Types Drug',
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (aErr) throw new Error(`insert asset: ${aErr.message}`);

    nctB = shortNct();
    trialBId = await insertTrial(
      svc, spaceId, (asset as { id: string }).id, 'Types Trial B', createdBy, nctB
    );

    const fullPayload = (startDate: string, pcdDate: string, endDate: string) => ({
      protocolSection: {
        statusModule: {
          startDateStruct:             { date: startDate, type: 'ANTICIPATED' },
          primaryCompletionDateStruct: { date: pcdDate,   type: 'ANTICIPATED' },
          completionDateStruct:        { date: endDate,   type: 'ANTICIPATED' },
        },
      },
    });

    // 3 syncs with all three date types — verifies UPSERT does not create duplicates
    await ingest(svc, trialBId, spaceId, nctB, 1, '2026-01-01', fullPayload('2026-03', '2027-06', '2027-12'));
    await ingest(svc, trialBId, spaceId, nctB, 2, '2026-02-01', fullPayload('2026-04', '2027-07', '2028-01'));
    await ingest(svc, trialBId, spaceId, nctB, 3, '2026-03-01', fullPayload('2026-05', '2027-08', '2028-02'));
  }, 120_000);

  afterAll(async () => {
    if (agencyId) await cleanupAgencyWithGucBypass(agencyId);
  });

  it('exactly one Trial Start marker after 3 syncs (drift fix)', async () => {
    const markers = await queryMarkers(trialBId, TRIAL_START_MARKER_TYPE_ID);
    expect(markers).toHaveLength(1);
  });

  it('exactly one PCD marker after 3 syncs (drift fix)', async () => {
    const markers = await queryMarkers(trialBId, PCD_MARKER_TYPE_ID);
    expect(markers).toHaveLength(1);
  });

  it('exactly one Trial End marker after 3 syncs (drift fix)', async () => {
    const markers = await queryMarkers(trialBId, TRIAL_END_MARKER_TYPE_ID);
    expect(markers).toHaveLength(1);
  });

  it('all three marker types carry metadata.source === ctgov', async () => {
    const starts = await queryMarkers(trialBId, TRIAL_START_MARKER_TYPE_ID);
    const pcds   = await queryMarkers(trialBId, PCD_MARKER_TYPE_ID);
    const ends   = await queryMarkers(trialBId, TRIAL_END_MARKER_TYPE_ID);
    expect(starts[0]?.metadata?.['source']).toBe('ctgov');
    expect(pcds[0]?.metadata?.['source']).toBe('ctgov');
    expect(ends[0]?.metadata?.['source']).toBe('ctgov');
  });

  it('final Trial Start date reflects last sync (v3 month midpoint)', async () => {
    const markers = await queryMarkers(trialBId, TRIAL_START_MARKER_TYPE_ID);
    // v3 start = '2026-05' -> month midpoint via precisionMidpointISO (TS/SQL drift pin)
    expect(markers[0]?.event_date).toBe(precisionMidpointISO('month', 2026, 5));
  });
});

// ---------------------------------------------------------------------------
// Group 5: import -> ct.gov adoption
// ---------------------------------------------------------------------------

describe('group 5: import -> ct.gov adoption', () => {
  let agencyId: string;
  let spaceId: string;
  let trialCId: string;  // NCT trial: one analyst marker -> adopted on sync
  let trialDId: string;  // non-NCT trial: analyst marker untouched
  let nctC: string;

  beforeAll(async () => {
    const scratch = await createScratchAgency(p);
    spaceId = scratch.spaceId;
    agencyId = scratch.agencyId;
    const createdBy = p.ids.platform_admin;

    const { data: co, error: coErr } = await svc
      .from('companies')
      .insert({ space_id: spaceId, name: 'Adopt Co', created_by: createdBy })
      .select('id')
      .single();
    if (coErr) throw new Error(`insert company: ${coErr.message}`);

    const { data: asset, error: aErr } = await svc
      .from('assets')
      .insert({
        space_id: spaceId,
        company_id: (co as { id: string }).id,
        name: 'Adopt Drug',
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (aErr) throw new Error(`insert asset: ${aErr.message}`);
    const assetId = (asset as { id: string }).id;

    nctC = shortNct();

    // trial_C: NCT-linked; one analyst-owned (un-owned) Trial Start -> adopted on sync.
    trialCId = await insertTrial(svc, spaceId, assetId, 'Adopt Trial C', createdBy, nctC);

    // Insert an analyst-owned Trial Start (mirrors _create_trial_date_markers output:
    // metadata.source = 'analyst', no 'ctgov' source). Un-owned = eligible for adoption.
    const { data: markerC, error: mCErr } = await svc
      .from('markers')
      .insert({
        space_id: spaceId,
        marker_type_id: TRIAL_START_MARKER_TYPE_ID,
        title: 'Trial Start',
        projection: 'company',
        event_date: '2025-03-01',
        date_precision: 'exact',
        metadata: { source: 'analyst' },
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (mCErr) throw new Error(`insert analyst marker C: ${mCErr.message}`);

    const { error: maErr } = await svc
      .from('marker_assignments')
      .insert({ marker_id: (markerC as { id: string }).id, trial_id: trialCId });
    if (maErr) throw new Error(`insert marker_assignment C: ${maErr.message}`);

    // trial_D: no NCT, just an analyst Trial Start (never synced, must be untouched)
    trialDId = await insertTrial(svc, spaceId, assetId, 'Manual Trial D', createdBy);

    const { data: markerD, error: mDErr } = await svc
      .from('markers')
      .insert({
        space_id: spaceId,
        marker_type_id: TRIAL_START_MARKER_TYPE_ID,
        title: 'Trial Start',
        projection: 'company',
        event_date: '2025-06-01',
        date_precision: 'exact',
        metadata: { source: 'analyst' },
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (mDErr) throw new Error(`insert analyst marker D: ${mDErr.message}`);

    const { error: maErrD } = await svc
      .from('marker_assignments')
      .insert({ marker_id: (markerD as { id: string }).id, trial_id: trialDId });
    if (maErrD) throw new Error(`insert marker_assignment D: ${maErrD.message}`);

    // Sync trial_C: one un-owned marker should be adopted (not duplicated)
    await ingest(svc, trialCId, spaceId, nctC, 1, '2026-01-01', {
      protocolSection: {
        statusModule: { startDateStruct: { date: '2026-05-20', type: 'ACTUAL' } },
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (agencyId) await cleanupAgencyWithGucBypass(agencyId);
  });

  it('trial_C after sync: exactly one Trial Start (adopted, not duplicated)', async () => {
    const markers = await queryMarkers(trialCId, TRIAL_START_MARKER_TYPE_ID);
    expect(markers).toHaveLength(1);
  });

  it('trial_C adopted marker: metadata.source is now ctgov', async () => {
    const markers = await queryMarkers(trialCId, TRIAL_START_MARKER_TYPE_ID);
    expect(markers[0]?.metadata?.['source']).toBe('ctgov');
  });

  it('trial_C adopted marker: event_date refreshed from ct.gov', async () => {
    const markers = await queryMarkers(trialCId, TRIAL_START_MARKER_TYPE_ID);
    // ct.gov provided '2026-05-20' (ACTUAL = exact, stored verbatim)
    expect(markers[0]?.event_date).toBe('2026-05-20');
  });

  it('trial_D (non-NCT, never synced): analyst Trial Start remains analyst-owned', async () => {
    const markers = await queryMarkers(trialDId, TRIAL_START_MARKER_TYPE_ID);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.metadata?.['source']).toBe('analyst');
    expect(markers[0]?.event_date).toBe('2025-06-01');
  });
});

// ---------------------------------------------------------------------------
// Group 6: deriveTrialPhaseSpan matches old column behavior (incl. PCD fallback).
//
// Spec B5 requires proving the markers needed to derive the span surface
// THROUGH get_dashboard_data. To make the trials appear in the RPC output we
// wire the full company -> asset -> indication -> condition chain via the
// create_trial RPC (called as platform_admin, who is the scratch-space owner).
// create_trial inserts the trial row FIRST and the asset_indications rows
// LAST, so the trg_auto_derive ordering hazard (asset_indications before the
// trial nulls development_status) is handled inside the RPC.
//
// Each test derives the span from the RPC-returned markers (the spec-required
// proof) AND keeps a direct-pgQuery span assertion as the precise check.
// ---------------------------------------------------------------------------

describe('group 6: deriveTrialPhaseSpan matches old column behavior (via get_dashboard_data)', () => {
  let agencyId: string;
  let spaceId: string;
  let trialEId: string;  // start + PCD + end
  let trialFId: string;  // start + PCD only (PCD fallback for bar end)
  let nctE: string;
  let nctF: string;

  // get_dashboard_data response captured once after both syncs
  let dashboard: DashboardCompany[];
  let dashTrialE: DashboardTrial | null;
  let dashTrialF: DashboardTrial | null;

  beforeAll(async () => {
    const scratch = await createScratchAgency(p);
    spaceId = scratch.spaceId;
    agencyId = scratch.agencyId;
    const createdBy = p.ids.platform_admin;
    const admin = as(p, 'platform_admin'); // scratch-space owner; can call create_trial

    const { data: co, error: coErr } = await svc
      .from('companies')
      .insert({ space_id: spaceId, name: 'Span Co', created_by: createdBy })
      .select('id')
      .single();
    if (coErr) throw new Error(`insert company span: ${coErr.message}`);

    const { data: asset, error: aErr } = await svc
      .from('assets')
      .insert({
        space_id: spaceId,
        company_id: (co as { id: string }).id,
        name: 'Span Drug',
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (aErr) throw new Error(`insert asset span: ${aErr.message}`);
    const assetId = (asset as { id: string }).id;

    nctE = shortNct();
    nctF = shortNct();

    // create_trial wires trial_assets (via trigger) + trial_conditions +
    // condition_indication_map + indications + asset_indications, so the trial
    // surfaces through get_dashboard_data's company->asset->indication->trial
    // chain. No phase dates passed: ct.gov ingest is the only marker source, so
    // exactly one ctgov-owned marker per type is created.
    const { data: trialE, error: tEErr } = await admin.rpc('create_trial', {
      p_space_id: spaceId,
      p_asset_id: assetId,
      p_name: 'Span Trial E',
      p_identifier: nctE,
      p_phase_type: 'P3',
      p_indication_names: ['Span Indication'],
    });
    if (tEErr) throw new Error(`create_trial E: ${tEErr.message}`);
    trialEId = trialE as string;

    // trial_E: all three dates present -> Trial End should be the bar end
    await ingest(svc, trialEId, spaceId, nctE, 1, '2026-01-01', {
      protocolSection: {
        statusModule: {
          startDateStruct:             { date: '2023-01-15', type: 'ACTUAL' },
          primaryCompletionDateStruct: { date: '2024-06-15', type: 'ACTUAL' },
          completionDateStruct:        { date: '2024-12-15', type: 'ACTUAL' },
        },
      },
    });

    const { data: trialF, error: tFErr } = await admin.rpc('create_trial', {
      p_space_id: spaceId,
      p_asset_id: assetId,
      p_name: 'Span Trial F',
      p_identifier: nctF,
      p_phase_type: 'P3',
      p_indication_names: ['Span Indication'],
    });
    if (tFErr) throw new Error(`create_trial F: ${tFErr.message}`);
    trialFId = trialF as string;

    // trial_F: no completionDateStruct -> PCD is the fallback bar end
    await ingest(svc, trialFId, spaceId, nctF, 1, '2026-01-01', {
      protocolSection: {
        statusModule: {
          startDateStruct:             { date: '2024-03-01', type: 'ACTUAL' },
          primaryCompletionDateStruct: { date: '2025-09-01', type: 'ACTUAL' },
          // no completionDateStruct
        },
      },
    });

    // Read the dashboard once as the authenticated space owner (the real path).
    const { data, error } = await admin.rpc('get_dashboard_data', { p_space_id: spaceId });
    if (error) throw new Error(`get_dashboard_data: ${error.message}`);
    dashboard = data as DashboardCompany[];
    dashTrialE = findTrialInDashboard(dashboard, trialEId);
    dashTrialF = findTrialInDashboard(dashboard, trialFId);
  }, 120_000);

  afterAll(async () => {
    if (agencyId) await cleanupAgencyWithGucBypass(agencyId);
  });

  // --- The markers surface through get_dashboard_data (spec B5 core proof) ---

  it('trial_E appears in get_dashboard_data output', () => {
    expect(dashTrialE).not.toBeNull();
  });

  it('trial_E dashboard markers include Trial Start / PCD / Trial End', () => {
    const typeIds = (dashTrialE?.markers ?? []).map((m) => m.marker_type?.id);
    expect(typeIds).toContain(TRIAL_START_MARKER_TYPE_ID);
    expect(typeIds).toContain(PCD_MARKER_TYPE_ID);
    expect(typeIds).toContain(TRIAL_END_MARKER_TYPE_ID);
  });

  it('trial_E: span derived from get_dashboard_data markers matches expected start/end', () => {
    const span = deriveTrialPhaseSpan(dashboardMarkersToSpanInput(dashTrialE!.markers));
    expect(span.start).toBe('2023-01-15');
    expect(span.startPrecision).toBe('exact');
    // Trial End (2024-12-15) wins over PCD (2024-06-15)
    expect(span.end).toBe('2024-12-15');
    expect(span.endPrecision).toBe('exact');
  });

  it('trial_F appears in get_dashboard_data output', () => {
    expect(dashTrialF).not.toBeNull();
  });

  it('trial_F dashboard markers include Trial Start / PCD but NOT Trial End', () => {
    const typeIds = (dashTrialF?.markers ?? []).map((m) => m.marker_type?.id);
    expect(typeIds).toContain(TRIAL_START_MARKER_TYPE_ID);
    expect(typeIds).toContain(PCD_MARKER_TYPE_ID);
    expect(typeIds).not.toContain(TRIAL_END_MARKER_TYPE_ID);
  });

  it('trial_F PCD fallback: span derived from get_dashboard_data markers ends at PCD', () => {
    const span = deriveTrialPhaseSpan(dashboardMarkersToSpanInput(dashTrialF!.markers));
    expect(span.start).toBe('2024-03-01');
    // No Trial End marker -> end falls back to PCD (2025-09-01)
    expect(span.end).toBe('2025-09-01');
    expect(span.endPrecision).toBe('exact');
  });

  // --- Precise direct-DB checks (kept alongside the RPC proof) ---

  it('trial_E (direct DB): deriveTrialPhaseSpan start/end match (Trial End wins over PCD)', async () => {
    const rows = await pgQuery<{ marker_type_id: string; event_date: string; date_precision: string }>(
      `select m.marker_type_id, m.event_date::text, m.date_precision
         from public.marker_assignments ma
         join public.markers m on m.id = ma.marker_id
        where ma.trial_id = $1`,
      [trialEId]
    );
    const span = deriveTrialPhaseSpan(
      rows.map((m) => ({
        marker_type_id: m.marker_type_id,
        event_date: m.event_date,
        date_precision: m.date_precision as 'exact' | 'month' | 'quarter' | 'half' | 'year',
      }))
    );
    expect(span.start).toBe('2023-01-15');
    expect(span.startPrecision).toBe('exact');
    expect(span.end).toBe('2024-12-15');
    expect(span.endPrecision).toBe('exact');
  });

  it('trial_F (direct DB): no Trial End marker present (PCD fallback path)', async () => {
    const endMarkers = await queryMarkers(trialFId, TRIAL_END_MARKER_TYPE_ID);
    expect(endMarkers).toHaveLength(0);
  });

  it('trial_F (direct DB): deriveTrialPhaseSpan end === PCD date', async () => {
    const rows = await pgQuery<{ marker_type_id: string; event_date: string; date_precision: string }>(
      `select m.marker_type_id, m.event_date::text, m.date_precision
         from public.marker_assignments ma
         join public.markers m on m.id = ma.marker_id
        where ma.trial_id = $1`,
      [trialFId]
    );
    const span = deriveTrialPhaseSpan(
      rows.map((m) => ({
        marker_type_id: m.marker_type_id,
        event_date: m.event_date,
        date_precision: m.date_precision as 'exact' | 'month' | 'quarter' | 'half' | 'year',
      }))
    );
    expect(span.start).toBe('2024-03-01');
    expect(span.end).toBe('2025-09-01');
    expect(span.endPrecision).toBe('exact');
  });
});
