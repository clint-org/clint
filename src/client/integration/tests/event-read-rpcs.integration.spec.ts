/**
 * Phase A read-RPC backtest (Task A9, deliverable A + cross-space firewall).
 *
 * This is the data-correctness capstone for Phase A: it seeds the canonical
 * acceptance-matrix fixture (seed_events_model_qa) into a real space and proves
 * the REPOINTED read RPCs return the correct event-sourced data. Each `it()`
 * maps to one acceptance-matrix row (see the comment on each test).
 *
 * Layers exercised:
 *   - get_dashboard_data       (main timeline; SECURITY INVOKER) -> rows 1,2,3,11,12
 *   - get_events_page_data     (future-events list; SECURITY INVOKER) -> row 4
 *   - get_space_landing_stats  (landing tiles; SECURITY DEFINER) -> member-read proof
 *   - get_activity_feed        (detected-changes feed; SECURITY DEFINER) -> row 5 setup
 *   - get_bullseye_assets      (bullseye; SECURITY INVOKER) -> envelope shape (A4 limit)
 *   - direct adminClient events query: fields no RPC exposes (date_precision,
 *     stored significance/projection) are verified here and called out in comments.
 *
 * Honesty note: where get_dashboard_data returns an event WITH its visibility
 * flag rather than filtering it server-side (feed-only Leadership, hidden LOE),
 * we assert the FLAG is present and record that the timeline-exclusion gating is
 * unit-proven by the Stage 2c effectiveVisibility logic (client-side), not by
 * the server RPC. We do not weaken the row to green: the data must be correct.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;

// System event_type UUIDs (stable; seeded by the event_types migration).
const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013';
const ET_REGULATORY = 'a0000000-0000-0000-0000-000000000032';
const ET_DISTRIBUTION = 'a0000000-0000-0000-0000-000000000040';
const ET_LOE = 'a0000000-0000-0000-0000-000000000020';
const ET_STRATEGIC = 'a0000000-0000-0000-0000-000000000070';
const ET_LEADERSHIP = 'a0000000-0000-0000-0000-000000000050';

// Shapes of the get_dashboard_data jsonb tree. Event-anchored arrays keep the
// legacy 'marker_type_id'/'marker_type' jsonb keys (Phase A does not rename
// output keys); they carry the EVENT's type id.
interface DashEvent {
  id: string;
  title: string;
  visibility: string | null;
  significance: string | null;
  is_projected: boolean;
  projection: string | null;
  event_date: string;
  marker_type_id: string;
}
interface DashTrial {
  id: string;
  name: string;
  phase: string | null;
  phase_data: unknown;
  markers: DashEvent[];
}
interface DashIndication {
  trials: DashTrial[];
}
interface DashAsset {
  name: string;
  events: DashEvent[];
  indications: DashIndication[];
}
interface DashCompany {
  name: string;
  events: DashEvent[];
  assets: DashAsset[];
}

interface EventsPageItem {
  title: string;
  is_projected: boolean | null;
  event_date: string | null;
  marker_type_id?: string | null;
}
interface EventsPage {
  total: number;
  items: EventsPageItem[];
}

async function fetchDashboard(): Promise<DashCompany[]> {
  const r = await as(p, 'space_owner').rpc('get_dashboard_data', { p_space_id: p.org.spaceId });
  return expectOk(r) as unknown as DashCompany[];
}

function alphaCompany(dash: DashCompany[]): DashCompany {
  const co = dash.find((c) => c.name === 'QA Pharma Alpha');
  if (!co) throw new Error('QA Pharma Alpha company missing from dashboard');
  return co;
}
function alphaAsset(co: DashCompany): DashAsset {
  const a = co.assets.find((x) => x.name === 'QA Asset Alpha');
  if (!a) throw new Error('QA Asset Alpha missing from company.assets');
  return a;
}

beforeAll(async () => {
  p = await buildPersonas();
  // Seed the canonical acceptance-matrix fixture into the personas space.
  const seeded = await as(p, 'space_owner').rpc('seed_events_model_qa', {
    p_space_id: p.org.spaceId,
  });
  expectOk(seeded);
}, 120_000);

describe('Phase A read-RPC backtest (acceptance matrix)', () => {
  const admin = adminClient();

  // --- Row 1: clinical event on a trial surfaces on the trial timeline ------
  it('row 1: get_dashboard_data surfaces the Topline clinical event on the QA trial', async () => {
    const asset = alphaAsset(alphaCompany(await fetchDashboard()));
    // Trials nest under an auto-derived (is_unspecified) indication.
    const trial = asset.indications.flatMap((i) => i.trials).find((t) => t.name.startsWith('QA Trial'));
    expect(trial).toBeDefined();
    const topline = trial!.markers.find((m) => m.marker_type_id === ET_TOPLINE);
    expect(topline, 'Topline event must render on the trial timeline').toBeDefined();
    expect(topline!.title).toContain('topline');
  });

  // --- Row 2: high-significance commercial event on the asset lane ----------
  it('row 2: get_dashboard_data surfaces the high-sig Distribution event on the asset', async () => {
    const asset = alphaAsset(alphaCompany(await fetchDashboard()));
    const dist = asset.events.find((e) => e.marker_type_id === ET_DISTRIBUTION);
    expect(dist, 'Distribution event must render on the asset lane').toBeDefined();

    // The fixture leaves Distribution.significance NULL so it INHERITS the type
    // default; the dashboard RPC does not resolve inheritance, so its emitted
    // significance is null. Effective high is verified at the data layer:
    const { data: row } = await admin
      .from('events')
      .select('significance')
      .eq('space_id', p.org.spaceId)
      .eq('event_type_id', ET_DISTRIBUTION)
      .single();
    expect(row!.significance).toBeNull(); // stored null = inherits
    const { data: et } = await admin
      .from('event_types')
      .select('default_significance')
      .eq('id', ET_DISTRIBUTION)
      .single();
    expect(et!.default_significance).toBe('high'); // effective significance = high
  });

  // --- Row 3: pinned -> band; low-sig feed-only Leadership flagged off band --
  it('row 3: company band carries the pinned Strategic event and flags feed-only Leadership', async () => {
    const co = alphaCompany(await fetchDashboard());
    const strategic = co.events.find((e) => e.marker_type_id === ET_STRATEGIC);
    const leadership = co.events.find((e) => e.marker_type_id === ET_LEADERSHIP);
    expect(strategic, 'pinned Strategic event present on company band').toBeDefined();
    expect(strategic!.visibility).toBe('pinned');

    // get_dashboard_data returns the feed-only Leadership WITH visibility=null
    // (it does not strip it server-side). The band-vs-feed gating is applied by
    // the Stage 2c effectiveVisibility logic (unit-proven), so here we assert
    // the flag the client gates on.
    expect(leadership, 'Leadership event returned with its flag').toBeDefined();
    expect(leadership!.visibility).toBeNull(); // feed-only marker

    // Data layer: Leadership significance stored null -> inherits type default low.
    const { data: lead } = await admin
      .from('events')
      .select('significance, visibility')
      .eq('space_id', p.org.spaceId)
      .eq('event_type_id', ET_LEADERSHIP)
      .single();
    expect(lead!.significance).toBeNull();
    expect(lead!.visibility).toBeNull();
    const { data: et } = await admin
      .from('event_types')
      .select('default_significance')
      .eq('id', ET_LEADERSHIP)
      .single();
    expect(et!.default_significance).toBe('low');
  });

  // --- Row 4: projected event carries projection + precision -----------------
  it('row 4: projected Regulatory event surfaces with is_projected via dashboard + events-page', async () => {
    // Dashboard (asset lane) flags it projected.
    const asset = alphaAsset(alphaCompany(await fetchDashboard()));
    const projDash = asset.events.find((e) => e.marker_type_id === ET_REGULATORY);
    expect(projDash, 'projected Regulatory event present on asset lane').toBeDefined();
    expect(projDash!.is_projected).toBe(true);

    // Events-page RPC also surfaces is_projected (drives the period-label).
    const epdRes = await as(p, 'space_owner').rpc('get_events_page_data', {
      p_space_id: p.org.spaceId,
      p_source_type: 'event',
      p_limit: 100,
      p_offset: 0,
    });
    const epd = expectOk(epdRes) as unknown as EventsPage;
    const projItem = epd.items.find((i) => i.is_projected === true);
    expect(projItem, 'events-page surfaces the projected item').toBeDefined();
    expect(projItem!.event_date).toBe('2026-10-01');

    // date_precision is NOT exposed by either RPC's item shape; verify the
    // stored projection metadata at the data layer.
    const { data: row } = await admin
      .from('events')
      .select('projection, is_projected, date_precision, event_date')
      .eq('space_id', p.org.spaceId)
      .eq('event_type_id', ET_REGULATORY)
      .single();
    expect(row!.projection).toBe('primary');
    expect(row!.is_projected).toBe(true);
    expect(row!.date_precision).toBe('quarter');
    expect(row!.event_date).toBe('2026-10-01');
  });

  // --- Row 11: phase bar still derives on event-sourced clinical trials ------
  it('row 11: get_dashboard_data still renders a non-empty phase bar on the QA trial', async () => {
    const asset = alphaAsset(alphaCompany(await fetchDashboard()));
    const trial = asset.indications.flatMap((i) => i.trials).find((t) => t.name.startsWith('QA Trial'));
    expect(trial).toBeDefined();
    // Phase bar fields present and non-empty.
    expect(trial!.phase).toBe('Phase 3');
    expect(trial!.phase_data).toBeTruthy();
    expect(trial!.phase_data).toMatchObject({ phase_type: 'P3' });
    // The clinical events that anchor the bar are present (regression guard).
    expect(trial!.markers.length).toBe(4);
  });

  // --- Row 12: hidden high-sig event must not render on the timeline ---------
  it('row 12: hidden LOE event is flagged hidden (excluded from the rendered timeline)', async () => {
    const asset = alphaAsset(alphaCompany(await fetchDashboard()));
    const loe = asset.events.find((e) => e.marker_type_id === ET_LOE);
    // get_dashboard_data returns the hidden event WITH visibility='hidden'
    // (no server-side strip); the Stage 2c effectiveVisibility logic excludes
    // hidden from the rendered timeline (unit-proven). Assert the flag here.
    expect(loe, 'hidden LOE returned with its flag').toBeDefined();
    expect(loe!.visibility).toBe('hidden');

    // Data layer: confirm hidden + high significance.
    const { data: row } = await admin
      .from('events')
      .select('visibility, significance')
      .eq('space_id', p.org.spaceId)
      .eq('event_type_id', ET_LOE)
      .single();
    expect(row!.visibility).toBe('hidden');
    expect(row!.significance).toBe('high');
  });

  // --- Row 5 setup: Activity feed = detected changes only --------------------
  it('row 5 setup: get_activity_feed excludes analyst-authored events (no trial_change_events seeded)', async () => {
    // The QA fixture seeds 10 authored events but ZERO trial_change_events.
    // get_activity_feed surfaces only detected-change rows, so it must be empty.
    const r = await as(p, 'space_owner').rpc('get_activity_feed', {
      p_space_id: p.org.spaceId,
      p_limit: 50,
    });
    const rows = expectOk(r) as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0); // none of the 10 authored events appear
  });

  // --- Bullseye: envelope shape + no error (A4 documented limitation) --------
  it('bullseye: get_bullseye_assets returns its envelope without error (recent_markers empty by A4 limit)', async () => {
    const r = await as(p, 'space_owner').rpc('get_bullseye_assets', { p_space_id: p.org.spaceId });
    const env = expectOk(r) as { assets: unknown; companies_with_intelligence: unknown };
    // Shape only: the QA fixture seeds no indications/asset_indications, so the
    // bullseye asset set (and any recent_markers) is empty by design (A4).
    expect(Array.isArray(env.assets)).toBe(true);
    expect(Array.isArray(env.companies_with_intelligence)).toBe(true);
  });

  // --- Member-read proof (pairs with the cross-space firewall below) ---------
  it('member read: get_space_landing_stats returns event-sourced tiles for the space owner', async () => {
    const r = await as(p, 'space_owner').rpc('get_space_landing_stats', { p_space_id: p.org.spaceId });
    const stats = expectOk(r) as Record<string, number> | null;
    expect(stats).not.toBeNull();
    expect(stats!['companies']).toBe(2);
    expect(stats!['programs']).toBe(2);
    expect(stats!['trials']).toBe(1);
    expect(stats!['intelligence_total']).toBe(1);
  });
});

// ============================================================================
// Cross-space read firewall: a persona with NO membership in the seeded space
// cannot read its events through any repointed read RPC.
//   - SECURITY DEFINER RPCs gate via has_space_access -> null / empty.
//   - SECURITY INVOKER RPCs gate via RLS -> empty.
// ============================================================================
describe('cross-space read firewall (no_memberships cannot read another space)', () => {
  it('get_dashboard_data (INVOKER): non-member gets an empty company set', async () => {
    const r = await as(p, 'no_memberships').rpc('get_dashboard_data', { p_space_id: p.org.spaceId });
    const dash = expectOk(r) as unknown as DashCompany[];
    expect(Array.isArray(dash)).toBe(true);
    expect(dash.length).toBe(0);
  });

  it('get_events_page_data (INVOKER): non-member gets zero events', async () => {
    const r = await as(p, 'no_memberships').rpc('get_events_page_data', {
      p_space_id: p.org.spaceId,
      p_source_type: 'event',
      p_limit: 100,
      p_offset: 0,
    });
    const epd = expectOk(r) as unknown as EventsPage;
    expect(epd.total).toBe(0);
    expect(epd.items.length).toBe(0);
  });

  it('get_activity_feed (DEFINER): non-member gets no rows', async () => {
    const r = await as(p, 'no_memberships').rpc('get_activity_feed', {
      p_space_id: p.org.spaceId,
      p_limit: 50,
    });
    const rows = expectOk(r) as unknown[];
    expect(rows.length).toBe(0);
  });

  it('get_space_landing_stats (DEFINER): non-member gets null (has_space_access denied)', async () => {
    const r = await as(p, 'no_memberships').rpc('get_space_landing_stats', { p_space_id: p.org.spaceId });
    const stats = expectOk(r) as unknown;
    expect(stats).toBeNull();
  });
});
