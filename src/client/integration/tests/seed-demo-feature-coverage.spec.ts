/**
 * Feature-coverage gate for seed_demo_data.
 *
 * Verifies that the seeder populates asset lanes (asset-anchored Approval +
 * Distribution events), the company band (pinned company-anchored event), and
 * produces a feed-only low-significance Leadership event. Also asserts that
 * re-seeding is idempotent (event count unchanged on a second call).
 *
 * This spec is intentionally RED until Task 2 (the seeder rewrite) lands.
 * The "seeds events" and "idempotent" cases may already pass; the asset-lane
 * and pinned-company cases must fail against the current seed implementation.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

const ET_APPROVAL = 'a0000000-0000-0000-0000-000000000035';
const ET_DISTRIBUTION = 'a0000000-0000-0000-0000-000000000040';
const ET_LEADERSHIP = 'a0000000-0000-0000-0000-000000000050';

let p: Personas;

beforeAll(async () => {
  p = await buildPersonas();
  // space_owner is a non-platform-admin owner of p.org.spaceId.
  expectOk(await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId }));
}, 120_000);

describe('seed_demo_data feature coverage (fresh non-admin owner space)', () => {
  it('seeds events on the owner space', async () => {
    const r = await as(p, 'space_owner')
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);
    expect(r.count ?? 0).toBeGreaterThan(0);
  });

  it('populates asset lanes: >= 2 assets each have an asset-anchored Approval AND Distribution', async () => {
    const r = await as(p, 'space_owner')
      .from('events')
      .select('anchor_id, event_type_id')
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'asset')
      .in('event_type_id', [ET_APPROVAL, ET_DISTRIBUTION]);
    expect(r.error).toBeNull();
    const byAsset = new Map<string, Set<string>>();
    for (const row of r.data ?? []) {
      const set = byAsset.get(row.anchor_id) ?? new Set<string>();
      set.add(row.event_type_id);
      byAsset.set(row.anchor_id, set);
    }
    const complete = [...byAsset.values()].filter(
      (s) => s.has(ET_APPROVAL) && s.has(ET_DISTRIBUTION),
    );
    expect(complete.length).toBeGreaterThanOrEqual(2);
  });

  it('seeds at least one high-significance asset-anchored Distribution (hexagon) event', async () => {
    const r = await as(p, 'space_owner')
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'asset')
      .eq('event_type_id', ET_DISTRIBUTION)
      .eq('significance', 'high');
    expect(r.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('company band: at least one pinned company-anchored event', async () => {
    const r = await as(p, 'space_owner')
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'company')
      .eq('visibility', 'pinned');
    expect(r.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('company band: a low-significance leadership event is feed-only (no high sig, not pinned)', async () => {
    const r = await as(p, 'space_owner')
      .from('events')
      .select('significance, visibility')
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'company')
      .eq('event_type_id', ET_LEADERSHIP);
    expect(r.error).toBeNull();
    expect((r.data ?? []).some((e) => e.significance !== 'high' && e.visibility === null)).toBe(
      true,
    );
  });

  it('approval-to-distribution gap differs between two assets (comparison is meaningful)', async () => {
    const r = await as(p, 'space_owner')
      .from('events')
      .select('anchor_id, event_type_id, event_date')
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'asset')
      .in('event_type_id', [ET_APPROVAL, ET_DISTRIBUTION]);
    expect(r.error).toBeNull();
    const gaps = new Map<string, { appr?: number; dist?: number }>();
    for (const row of r.data ?? []) {
      const g = gaps.get(row.anchor_id) ?? {};
      const t = new Date(row.event_date as string).getTime();
      if (row.event_type_id === ET_APPROVAL) g.appr = t;
      else g.dist = t;
      gaps.set(row.anchor_id, g);
    }
    const spans = [...gaps.values()]
      .filter((g) => g.appr !== undefined && g.dist !== undefined)
      .map((g) => g.dist! - g.appr!);
    expect(spans.length).toBeGreaterThanOrEqual(2);
    // the two assets must have visibly different approval->distribution spans
    expect(Math.max(...spans) - Math.min(...spans)).toBeGreaterThan(180 * 24 * 3600 * 1000);
  });

  it('re-seeding is idempotent: event count unchanged', async () => {
    const before = await as(p, 'space_owner')
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);
    expectOk(await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId }));
    const after = await as(p, 'space_owner')
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);
    expect(after.count).toBe(before.count);
  });
});

// Event-type UUIDs (system, stable)
const T_TRIAL_START = 'a0000000-0000-0000-0000-000000000011';
const T_TRIAL_END   = 'a0000000-0000-0000-0000-000000000012';
const T_PCD         = 'a0000000-0000-0000-0000-000000000008';
const T_TOPLINE     = 'a0000000-0000-0000-0000-000000000013';
const A_REGFILING   = 'a0000000-0000-0000-0000-000000000032';
const A_APPROVAL    = 'a0000000-0000-0000-0000-000000000035';
const A_LAUNCH      = 'a0000000-0000-0000-0000-000000000036';
const A_DISTRIB     = 'a0000000-0000-0000-0000-000000000040';
const A_LOE         = 'a0000000-0000-0000-0000-000000000020';
const C_FINANCIAL   = 'a0000000-0000-0000-0000-000000000060';
const C_LEADERSHIP  = 'a0000000-0000-0000-0000-000000000050';
const C_STRATEGIC   = 'a0000000-0000-0000-0000-000000000070';

describe('seed_demo_data remodel invariants (fresh owner space)', () => {
  let p: Personas;
  beforeAll(async () => {
    p = await buildPersonas();
    expectOk(await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId }));
  }, 120_000);

  const rows = async () =>
    (await as(p, 'space_owner').from('events')
      .select('event_type_id, anchor_type, anchor_id, title, event_date, projection, significance, visibility')
      .eq('space_id', p.org.spaceId)).data ?? [];

  it('asset-lane types are never on a trial or company', async () => {
    const assetTypes = [A_REGFILING, A_APPROVAL, A_LAUNCH, A_DISTRIB, A_LOE];
    const misplaced = (await rows()).filter(
      (e) => assetTypes.includes(e.event_type_id) && e.anchor_type !== 'asset');
    expect(misplaced, JSON.stringify(misplaced.slice(0, 5))).toHaveLength(0);
  });

  it('corporate types are only on companies', async () => {
    const corp = [C_FINANCIAL, C_LEADERSHIP, C_STRATEGIC];
    const misplaced = (await rows()).filter(
      (e) => corp.includes(e.event_type_id) && e.anchor_type !== 'company');
    expect(misplaced, JSON.stringify(misplaced.slice(0, 5))).toHaveLength(0);
  });

  it('clinical types are only on trials', async () => {
    const clin = [T_TRIAL_START, T_TRIAL_END, T_PCD, T_TOPLINE];
    const misplaced = (await rows()).filter(
      (e) => clin.includes(e.event_type_id) && e.anchor_type !== 'trial');
    expect(misplaced, JSON.stringify(misplaced.slice(0, 5))).toHaveLength(0);
  });

  it('no two events share the same title (excluding structural phase-bar markers)', async () => {
    // 'Trial Start' / 'Trial End' are the structural per-trial phase-bar markers
    // emitted by _create_trial_date_markers (one per trial, generic title BY DESIGN,
    // and shared with the ct.gov sync path). The phase bar derives its span from them,
    // so every demo trial necessarily carries a generically titled start/end marker.
    // The dedup invariant targets the curated analyst facts (cross-trial fan-out
    // filings, semantic duplicates), not these structural markers, so exclude them.
    const STRUCTURAL_TITLES = new Set(['Trial Start', 'Trial End']);
    const seen = new Map<string, number>();
    for (const e of await rows()) {
      if (STRUCTURAL_TITLES.has(e.title)) continue;
      seen.set(e.title, (seen.get(e.title) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t);
    expect(dupes, JSON.stringify(dupes)).toHaveLength(0);
  });

  it('no projected event is dated before today (evergreen)', async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const stale = (await rows()).filter(
      (e) => e.projection !== 'actual' && new Date(e.event_date as string) < today);
    expect(stale, JSON.stringify(stale.slice(0, 8).map((e) => [e.title, e.event_date]))).toHaveLength(0);
  });

  it('projection vocabulary: primary and forecasted appear on asset/company events', async () => {
    const r = await rows();
    const nonTrial = r.filter((e) => e.anchor_type === 'asset' || e.anchor_type === 'company');
    expect(nonTrial.some((e) => e.projection === 'primary'), 'a primary asset/company event').toBe(true);
    expect(nonTrial.some((e) => e.projection === 'forecasted'), 'a forecasted asset/company event').toBe(true);
    expect(r.some((e) => e.projection === 'company'), 'a company-guided event').toBe(true);
    expect(r.some((e) => e.projection === 'actual'), 'an actual event').toBe(true);
  });

  it('one asset lane shows the full tier vocabulary', async () => {
    // group asset events by anchor and require some asset with >=3 distinct projection tiers
    const byAsset = new Map<string, Set<string>>();
    for (const e of await rows()) {
      if (e.anchor_type !== 'asset') continue;
      const s = byAsset.get(e.anchor_id as unknown as string) ?? new Set<string>();
      s.add(e.projection as string); byAsset.set(e.anchor_id as unknown as string, s);
    }
    const richest = Math.max(0, ...[...byAsset.values()].map((s) => s.size));
    expect(richest).toBeGreaterThanOrEqual(3);
  });

  it('corporate visibility: at least one pinned and one feed-only company event', async () => {
    const r = await rows();
    const co = r.filter((e) => e.anchor_type === 'company');
    expect(co.some((e) => e.visibility === 'pinned'), 'a pinned company event').toBe(true);
    expect(co.some((e) => e.visibility === null && e.significance !== 'high'),
      'a feed-only company event').toBe(true);
  });

  it('corporate band is explicitly curated: no company event surfaces via high+null', async () => {
    // The band shows an event when it is pinned OR high significance, so a
    // high-significance company event with null visibility would crowd the band
    // implicitly. Every band-surfacing corporate event must be pinned on purpose;
    // anything not pinned must be below high significance (feed-only).
    const implicit = (await rows()).filter(
      (e) => e.anchor_type === 'company' && e.significance === 'high' && e.visibility === null);
    expect(implicit, JSON.stringify(implicit.map((e) => e.title))).toHaveLength(0);
  });

  it('no trial carries more than one Trial Start event', async () => {
    const countByTrial = new Map<string, number>();
    for (const e of await rows()) {
      if (e.anchor_type !== 'trial' || e.event_type_id !== T_TRIAL_START) continue;
      countByTrial.set(e.anchor_id as string, (countByTrial.get(e.anchor_id as string) ?? 0) + 1);
    }
    const dupes = [...countByTrial.entries()].filter(([, n]) => n > 1);
    expect(dupes, JSON.stringify(dupes)).toHaveLength(0);
  });
});
