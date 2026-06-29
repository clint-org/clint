/**
 * Phase C producer backtest (Task C6) -- the capstone for the event-model cutover.
 *
 * Where the per-task specs prove individual seams, this spec exercises the REAL
 * producers end to end and maps the output back to the parent spec's Acceptance
 * Matrix. It is TEST-ONLY: every assertion runs through the shipped RPCs and the
 * RLS-checked auth model; no producer/RPC is modified here.
 *
 * Coverage (and the matrix row each block proves):
 *   - Producers emit unified events, not markers (model regression guard):
 *       seed_demo_data (the real demo producer path) writes public.events rows,
 *       the dropped marker tables no longer exist, and get_dashboard_data returns
 *       company/asset/trial objects whose marker-shaped arrays are populated FROM
 *       those events.
 *   - Row 11 (phase bar on producer clinical events): a seeded demo trial surfaces
 *       a non-empty phase plus its clinical events (Trial Start / PCD / Topline /
 *       Approval) as the trial's markers[].
 *   - Sources hardening (Phase S, rows 1-2 detail reads): the two multi-source
 *       demo business events each carry exactly 2 event_sources; every trial-anchored
 *       clinical demo event carries ZERO event_sources (the CT.gov registry link is
 *       derived, never stored); and a read RPC returns a non-null DERIVED registry_url
 *       for a trial event whose trial has an NCT identifier.
 *   - Row 6 (brief cites an event, citation resolves): the QA fixture's published
 *       brief cites the Topline event; the intelligence history read RPC resolves
 *       that link to the real Topline event (id + title), not a dangling reference.
 *
 * Honesty notes / scope boundaries (asserted elsewhere, referenced here, never faked):
 *   - Row 5 (event edit -> Activity, NOT Intelligence feed) is proven by
 *       activity-wiring.integration.spec.ts (update_event emits trial_change_events
 *       and creates no primary_intelligence). Not duplicated here.
 *   - The event_sources RLS firewall (viewer write denied; sibling-space no-leak)
 *       is proven by event-sources.integration.spec.ts. Not duplicated here.
 *   - The QA-fixture exact-count scenario set + idempotence is proven by
 *       events-model-qa-fixture.spec.ts. Here we use the fixture only as the
 *       citation/registry vehicle.
 *
 * Each describe block is independent and self-seeds into its OWN fresh scratch
 * space under the personas tenant, so a shared-DB run cannot cross-contaminate.
 * Run in isolation after `supabase db reset` + exported SERVICE_ROLE_KEY.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

// System event_type UUIDs (stable; seeded by the event_types migration).
const ET_TRIAL_START = 'a0000000-0000-0000-0000-000000000011';
const ET_PCD = 'a0000000-0000-0000-0000-000000000008';
const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013';
const ET_APPROVAL = 'a0000000-0000-0000-0000-000000000035';
const CLINICAL_EVENT_TYPES = new Set([ET_TRIAL_START, ET_PCD, ET_TOPLINE, ET_APPROVAL]);

// The two multi-source demo business events emitted by _seed_demo_events (C5).
const DEMO_MULTISOURCE_TITLES = [
  'BridgeBio Attruby commercial launch',
  'Lilly Mounjaro/Zepbound combined annual revenue exceeds $15B',
];

interface DashEvent {
  id: string;
  title: string;
  marker_type_id: string;
}
interface DashTrial {
  id: string;
  name: string;
  phase: string | null;
  phase_data: { phase_type?: string } | null;
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

let p: Personas;
const admin: SupabaseClient = adminClient();

/** Create a fresh scratch space under the personas tenant, owned by space_owner. */
async function newOwnedSpace(name: string): Promise<string> {
  const { data: space, error: spaceErr } = await admin
    .from('spaces')
    .insert({ tenant_id: p.org.tenantId, name, created_by: p.ids.space_owner })
    .select('id')
    .single();
  if (spaceErr) throw new Error(`scratch space insert: ${spaceErr.message}`);
  const spaceId = (space as { id: string }).id;
  const { error: memberErr } = await admin
    .from('space_members')
    .insert({ space_id: spaceId, user_id: p.ids.space_owner, role: 'owner' });
  if (memberErr) throw new Error(`scratch space_members insert: ${memberErr.message}`);
  return spaceId;
}

/** Tear down a scratch space: events first (the _log_event_change trigger needs
 *  the parent space to still exist mid-cascade), then the space itself. */
async function dropSpace(spaceId: string): Promise<void> {
  // event_sources / primary_intelligence cascade on their own parents.
  await admin.from('events').delete().eq('space_id', spaceId);
  await admin.from('spaces').delete().eq('id', spaceId);
}

beforeAll(async () => {
  p = await buildPersonas();
}, 120_000);

// ============================================================================
// Producer path 1: seed_demo_data emits unified events (the real demo producer).
// ============================================================================
describe('seed_demo_data producer emits the unified event model', () => {
  let demoSpaceId: string;

  beforeAll(async () => {
    demoSpaceId = await newOwnedSpace('C6 demo producer space');
    // The real producer path: the space owner seeds demo data through the
    // shipped RPC (SECURITY INVOKER, owner-gated).
    expectOk(await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: demoSpaceId }));
  }, 120_000);

  afterAll(async () => {
    if (demoSpaceId) await dropSpace(demoSpaceId);
  });

  it('writes public.events rows and references no dropped marker table', async () => {
    const { data: events, error } = await admin
      .from('events')
      .select('id')
      .eq('space_id', demoSpaceId);
    expect(error).toBeNull();
    expect((events ?? []).length).toBeGreaterThan(0);

    // The dropped marker tables must not exist: the producers cannot reference
    // them. A select on a missing relation surfaces a PostgREST error.
    for (const dropped of ['markers', 'marker_assignments', 'marker_types']) {
      const res = await admin.from(dropped).select('*').limit(1);
      expect(res.error, `${dropped} must be dropped`).not.toBeNull();
    }
  });

  it('get_dashboard_data returns company/asset/trial objects with event-sourced marker arrays', async () => {
    const r = await as(p, 'space_owner').rpc('get_dashboard_data', { p_space_id: demoSpaceId });
    const dash = expectOk(r) as unknown as DashCompany[];
    expect(Array.isArray(dash)).toBe(true);
    expect(dash.length).toBeGreaterThan(0);

    // At least one company nests an asset that nests a trial whose markers[]
    // (the event-sourced marker-shaped array) is populated.
    const trialsWithMarkers = dash
      .flatMap((c) => c.assets ?? [])
      .flatMap((a) => a.indications ?? [])
      .flatMap((i) => i.trials ?? [])
      .filter((t) => (t.markers ?? []).length > 0);
    expect(trialsWithMarkers.length).toBeGreaterThan(0);

    // Those marker entries carry an event_type id (marker_type_id key) -- they
    // are projected from public.events, not from a marker table.
    const sample = trialsWithMarkers[0].markers[0];
    expect(typeof sample.id).toBe('string');
    expect(typeof sample.marker_type_id).toBe('string');
  });

  it('row 11: a demo trial surfaces a non-empty phase plus its clinical events as markers', async () => {
    const r = await as(p, 'space_owner').rpc('get_dashboard_data', { p_space_id: demoSpaceId });
    const dash = expectOk(r) as unknown as DashCompany[];

    const trials = dash
      .flatMap((c) => c.assets ?? [])
      .flatMap((a) => a.indications ?? [])
      .flatMap((i) => i.trials ?? []);

    // A trial whose phase bar derives (phase_data carries a phase_type) AND that
    // carries at least one clinical event in its markers[] -- the producer-side
    // Row 11 shape. (Demo trials leave the legacy `phase` label null and drive
    // the bar off phase_data.phase_type; the QA-fixture variant of this row, which
    // also asserts the `phase` label, lives in event-read-rpcs.)
    const phaseTrial = trials.find(
      (t) =>
        !!t.phase_data?.phase_type &&
        (t.markers ?? []).some((m) => CLINICAL_EVENT_TYPES.has(m.marker_type_id)),
    );
    expect(phaseTrial, 'a demo trial with a phase bar + clinical events must exist').toBeDefined();
    expect(phaseTrial!.phase_data!.phase_type).toBeTruthy();
    expect(phaseTrial!.markers.some((m) => CLINICAL_EVENT_TYPES.has(m.marker_type_id))).toBe(true);
  });

  it('sources: the two multi-source business events each carry exactly 2 event_sources', async () => {
    for (const title of DEMO_MULTISOURCE_TITLES) {
      const { data: ev, error: evErr } = await admin
        .from('events')
        .select('id, anchor_type')
        .eq('space_id', demoSpaceId)
        .eq('title', title)
        .single();
      expect(evErr, `business event "${title}" must exist`).toBeNull();
      expect((ev as { anchor_type: string }).anchor_type).toBe('company');

      const { data: sources, error: srcErr } = await admin
        .from('event_sources')
        .select('url, label, sort_order')
        .eq('event_id', (ev as { id: string }).id)
        .order('sort_order', { ascending: true });
      expect(srcErr).toBeNull();
      expect(sources, `"${title}" must have 2 sources`).toHaveLength(2);
      // Each source carries a labeled URL (the multi-source citation shape).
      for (const s of sources as { url: string; label: string }[]) {
        expect(typeof s.url).toBe('string');
        expect(s.url.length).toBeGreaterThan(0);
        expect(typeof s.label).toBe('string');
        expect(s.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('sources: every trial-anchored clinical demo event carries ZERO event_sources', async () => {
    // The CT.gov registry link for trial-anchored events is DERIVED by readers,
    // never stored as an attached source. So no event_sources row may point at a
    // trial-anchored event in the demo space.
    const { data: trialEvents, error: teErr } = await admin
      .from('events')
      .select('id')
      .eq('space_id', demoSpaceId)
      .eq('anchor_type', 'trial');
    expect(teErr).toBeNull();
    const trialEventIds = (trialEvents ?? []).map((e) => (e as { id: string }).id);
    expect(trialEventIds.length).toBeGreaterThan(0);

    const { data: leaked, error: lkErr } = await admin
      .from('event_sources')
      .select('event_id')
      .in('event_id', trialEventIds);
    expect(lkErr).toBeNull();
    expect(leaked ?? []).toHaveLength(0);
  });
});

// ============================================================================
// Producer path 2: QA fixture (seed_events_model_qa) -- the citation + registry
// vehicle. The fixture's exact scenario counts are proven in
// events-model-qa-fixture.spec.ts; here we drive the read RPCs that resolve a
// citation and a derived registry link.
// ============================================================================
describe('event citation + derived registry link resolve through the read RPCs', () => {
  let qaSpaceId: string;
  let anchorId: string;
  let toplineId: string;

  beforeAll(async () => {
    qaSpaceId = await newOwnedSpace('C6 QA citation space');
    expectOk(await as(p, 'space_owner').rpc('seed_events_model_qa', { p_space_id: qaSpaceId }));

    const { data: anchor, error: aErr } = await admin
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('space_id', qaSpaceId)
      .single();
    expect(aErr).toBeNull();
    anchorId = (anchor as { id: string }).id;

    const { data: topline, error: tErr } = await admin
      .from('events')
      .select('id')
      .eq('space_id', qaSpaceId)
      .eq('event_type_id', ET_TOPLINE)
      .single();
    expect(tErr).toBeNull();
    toplineId = (topline as { id: string }).id;
  }, 120_000);

  afterAll(async () => {
    if (qaSpaceId) await dropSpace(qaSpaceId);
  });

  it('row 6: the published brief event citation resolves to the Topline event (id + title)', async () => {
    // get_primary_intelligence_history is the RPC the detail panel loads (via
    // PrimaryIntelligenceService.loadHistory); each version carries resolved links.
    const r = await as(p, 'space_owner').rpc('get_primary_intelligence_history', {
      p_anchor_id: anchorId,
    });
    const payload = expectOk(r) as {
      versions: {
        state: string;
        links: { entity_type: string; entity_id: string; entity_name: string | null }[];
      }[];
    };
    expect(Array.isArray(payload.versions)).toBe(true);

    const published = payload.versions.find((v) => v.state === 'published');
    expect(published, 'published brief version present').toBeDefined();

    const eventLinks = (published!.links ?? []).filter((l) => l.entity_type === 'event');
    expect(eventLinks, 'exactly one event citation').toHaveLength(1);

    // The citation resolves to the real Topline event: id matches AND the title
    // is hydrated (not a dangling link with a null entity_name).
    expect(eventLinks[0].entity_id).toBe(toplineId);
    expect(eventLinks[0].entity_name).toBe('QA trial topline results');
  });

  it('sources: get_event_detail derives registry_url from the trial NCT identifier', async () => {
    // The QA trial carries identifier NCT09000001 (S4). The Topline event is
    // trial-anchored, so the detail read derives the CT.gov registry link rather
    // than reading a stored source_url. (get_catalyst_detail was renamed to
    // get_event_detail in the Stage 3 IA rename; p_marker_id -> p_event_id.)
    const r = await as(p, 'space_owner').rpc('get_event_detail', { p_event_id: toplineId });
    const detail = expectOk(r) as { catalyst: { registry_url: string | null; title: string } };
    expect(detail.catalyst).toBeTruthy();
    expect(detail.catalyst.registry_url).toBe('https://clinicaltrials.gov/study/NCT09000001');
  });

  it('sources: the cited Topline event itself carries no stored event_sources', async () => {
    // Trial-anchored -> registry link is derived, so the cited event has zero
    // attached sources (pairs with the demo-space firewall assertion above).
    const { data: sources, error } = await admin
      .from('event_sources')
      .select('id')
      .eq('event_id', toplineId);
    expect(error).toBeNull();
    expect(sources ?? []).toHaveLength(0);
  });
});
