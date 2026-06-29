# Seed Demo Data: Model-Fit + Feature-Coverage Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `seed_demo_data` a clean, fully on-model, idempotent, owner-gated any-space seeder whose demo landscape natively exercises every surface of the redesigned events timeline (company band, asset lanes, hexagon commercial events, significance high/low, two-asset approval-to-distribution comparison).

**Architecture:** The orchestrator `seed_demo_data(p_space_id)` and its `_seed_demo_*` helper chain were already cut over to the unified `events` model (migration `20260628290000`, "C5") and already carry auth + owner gating + idempotency (migration `20260501020000`, persisting through `20260627130000`). An audit (below) confirms the chain writes only to the unified model and has no residual marker / marker_assignment / phase-span writes. The remaining gap is **feature coverage**: the seed anchors clinical events to trials and business events to companies, so **asset lanes render empty** and the company band lacks a pinned and a feed-only low-significance example. This plan adds those events in one new migration that redefines a single helper (`_seed_demo_events`) from its live definition, and proves the result with one new integration spec.

**Tech Stack:** PostgreSQL (Supabase migrations, plpgsql SECURITY DEFINER functions), Vitest + supabase-js integration tests, Angular 19 timeline client (verification only).

## Audit findings (already done before this plan — do not redo)

- **Owner gating + idempotency: DONE.** The live `seed_demo_data(p_space_id)` raises `28000` if unauthenticated, raises `42501` ("Insufficient permissions: must be space owner") unless the caller is a `space_members` owner of `p_space_id` or `is_platform_admin()`, and no-ops if the space already has companies. `role-access.spec.ts` already asserts the full matrix: reader/contributor/tenant_owner/agency rejected `42501`; space_owner ok; second call idempotent ok; platform_admin ok.
- **Model fit: DONE.** Every `_seed_demo_*` helper writes to `public.events` / `public.event_sources` / `public.trial_change_events` (the activity surface) plus the entity tables (`companies`/`assets`/`trials`/`indications`/`asset_indications`/`materials`/`primary_intelligence`/`trial_notes`). A scan of all live helper bodies found `marker` / `marker_type` / `phase_*_date` / `catalyst` only inside comments and inert jsonb passthrough payloads, never as table writes. `events.source_url` (dropped in `20260628320000`) is not referenced by any helper.
- **`event-producers.integration.spec.ts` does not exist** in the repo. The only spec referencing the seeder is `role-access.spec.ts`, and it asserts gate behavior only (no counts/entities). So the spec-update burden is: keep `role-access.spec.ts` green, and add one new composition spec.

## Key design decision: inline DEFINER inserts, NOT create_event

The new feature-coverage events are seeded with **inline `insert into public.events` statements inside the SECURITY DEFINER helper**, exactly like the existing C5 helpers — they are **not** routed through `create_event`.

Reason (verified, not optional): `create_event` gates on `has_space_access(p_space_id, array['owner','editor'])`, and `has_space_access` grants a platform admin only a **read-only** bypass (`if not v_is_write and is_platform_admin()`). The `role-access.spec.ts` case "rpc seed_demo_data: ok (platform admin disjunct)" requires `seed_demo_data` to succeed for a platform admin who is **not** an owner/editor and has no `space_members` row. Routing through `create_event` would raise `42501` for that caller and break the test. The SECURITY DEFINER inline insert bypasses RLS and works for every authorized caller. This is the same rationale the C5 migration documents. (The guardrail "only call create_event, do not redefine it" is honored: we do not redefine `create_event`; we simply do not call it, consistent with the existing producer chain.)

## Feature-coverage target (from `docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md`)

Rendering model (verified in `marker-visibility.ts:10-15`, `dashboard-grid.component.ts:354/374`, and `20260628090000_dashboard_data_asset_company_events.sql`):

```
showsOnRow(event, row) = hasDate(event) AND event.anchor == row.entity   // direct match, NO roll-up
                         AND effectiveVisibility(event)
effectiveVisibility(e) = visibility=='pinned' ? true
                       : visibility=='hidden' ? false
                       : significance(e) == 'high'      // high shown on timeline; low/null feed-only
```

Acceptance rows this plan must make renderable from the demo seed without hand-augmentation:

| Matrix row | Requirement | Data shape this plan seeds |
| --- | --- | --- |
| #2 | High-significance commercial Distribution on an asset lane | `event_type_id`=Distribution (`a0..040`, hexagon), `anchor_type='asset'`, `significance='high'` |
| #3 / #13 | Low-significance leadership event on a company, feed-only | Leadership Change (`a0..050`), `anchor_type='company'`, `significance` null, `visibility` null |
| #14 | A pinned company-level event on the company band | company-anchored event, `visibility='pinned'` (use a low-default-significance type so the pin is what promotes it) |
| #10 | Two asset rows stacked; approval-to-distribution gap visible | Two assets each with an asset-anchored Approval (`a0..035`, flag) and a later asset-anchored Distribution (`a0..040`, hexagon), with deliberately different gaps |

Significance high/low (task item 4) is covered by the high-sig asset commercial events and the low-sig leadership event. The two existing multi-source business events (`event_sources` with two labeled rows each) stay as the provenance/`p_sources` example.

## Entity keys available to `_seed_demo_events` (from `_seed_ids`)

`_seed_demo_events` already looks up companies via `(select id from _seed_ids where entity_type = 'company' and key = ...)`. Assets are registered in `_seed_ids` with **`entity_type = 'product'`** (per `_seed_demo_assets`), even though `events.anchor_type` for an asset is the literal string `'asset'`. So an asset-anchored event looks the id up with `entity_type='product'` and inserts with `anchor_type='asset'`.

Assets used by this plan (all seeded by `_seed_demo_assets`):
- `p_wegovy` (Wegovy, semaglutide, company `c_vantage`)
- `p_zepbound` (Zepbound, tirzepatide, company `c_meridian`)
- `p_attruby` (Attruby, acoramidis, company `c_atlas`)

## Migration numbering

Develop's highest migration is `20260629030000`. Stage 3 holds unmerged `20260629040000` / `20260629040100`; the import session takes `20260629050000+`. This plan's migration is **`20260629060000`**, clear of all three.

## File Structure

- **Create** `supabase/migrations/20260629060000_seed_demo_feature_coverage.sql` — `create or replace function public._seed_demo_events(...)` based on the **live** definition, with one re-anchor edit and one new appended block; ends with an in-file smoke and `notify pgrst, 'reload schema'`.
- **Create** `src/client/integration/tests/seed-demo-feature-coverage.spec.ts` — proves a fresh non-admin owner's space seeds the full feature-coverage landscape and that re-seeding is a no-op.
- **No change** to `seed_demo_data` orchestrator (already gated + idempotent), the other `_seed_demo_*` helpers (already on-model), `dashboard.service.ts`, or `seed-demo.component.ts`.
- **Regen (committed)** `docs/runbook/*` auto-gen blocks via `npm run docs:arch` (migrations changed).

## Global Constraints

- No emojis; no em-dashes (use commas, colons, periods); no Claude attribution in copy, comments, commits, or PR.
- Branch `feat/seed-demo-refresh` off `origin/develop`, worktree `.worktrees/seed-demo-refresh`, `src/client/node_modules` symlinked from the main checkout. Never push `feat/event-model`, `feat/event-model-stage-3`, or the import branch.
- Shared local Supabase DB is the hazard: this is the THIRD DB-heavy session. Do **not** `supabase db reset` or run integration tests while another session is mid-run. Serialize those moments; run integration specs in isolation.
- Base every `create or replace` on the **live** `pg_get_functiondef` output, never an older migration copy. End the migration with `notify pgrst, 'reload schema'`.
- Only **call** `create_event`; never redefine `create_event` / `update_event` / `get_event_detail` (other sessions own them). This plan does not call `create_event` either (see design decision above); it uses inline DEFINER inserts consistent with the existing producer chain. We own `seed_demo_data` and all `_seed_demo_*` helpers.
- Demo content is current and real as of Jan 2026. Keep the landscape; do not broaden or rewrite it. Fix only clear factual errors spotted in passing.

---

### Task 1: Failing integration spec for feature coverage + fresh-owner idempotency

**Files:**
- Create: `src/client/integration/tests/seed-demo-feature-coverage.spec.ts`

**Interfaces:**
- Consumes: the persona harness used by `role-access.spec.ts` (the `setupPersonas` / `as(p, role)` / `expectOk` helpers in `src/client/integration/`). Inspect `role-access.spec.ts` imports at implementation time and reuse the exact same harness module and `space_owner` persona (a non-platform-admin owner of `p.org.spaceId`).
- Produces: nothing consumed by later tasks; this is the red/green gate for Task 2.

**Event type UUIDs (system, stable):** Approval `a0000000-0000-0000-0000-000000000035`, Distribution `a0000000-0000-0000-0000-000000000040`, Leadership Change `a0000000-0000-0000-0000-000000000050`.

- [ ] **Step 1: Write the failing test**

Create `src/client/integration/tests/seed-demo-feature-coverage.spec.ts`. Mirror the import block and persona-setup lifecycle of `role-access.spec.ts` exactly (same harness path, same `beforeAll`/`afterAll`). Use the `space_owner` persona (a non-admin owner) and seed `p.org.spaceId`. Read events back with the service-role client so RLS does not filter the assertions.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Reuse the SAME harness import path that role-access.spec.ts uses.
import { setupPersonas, teardownPersonas, as, expectOk, serviceClient } from './_harness'; // <- match role-access.spec.ts actual path/exports

const ET_APPROVAL = 'a0000000-0000-0000-0000-000000000035';
const ET_DISTRIBUTION = 'a0000000-0000-0000-0000-000000000040';
const ET_LEADERSHIP = 'a0000000-0000-0000-0000-000000000050';

describe('seed_demo_data feature coverage (fresh non-admin owner space)', () => {
  let p: Awaited<ReturnType<typeof setupPersonas>>;
  const svc = serviceClient();

  beforeAll(async () => {
    p = await setupPersonas();
    // space_owner is a non-platform-admin owner of p.org.spaceId.
    expectOk(await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId }));
  });
  afterAll(async () => { await teardownPersonas(p); });

  it('seeds events on the owner space', async () => {
    const r = await svc.from('events').select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);
    expect(r.count ?? 0).toBeGreaterThan(0);
  });

  it('populates asset lanes: >= 2 assets each have an asset-anchored Approval AND Distribution', async () => {
    const r = await svc.from('events')
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
    const complete = [...byAsset.values()].filter(s => s.has(ET_APPROVAL) && s.has(ET_DISTRIBUTION));
    expect(complete.length).toBeGreaterThanOrEqual(2);
  });

  it('seeds at least one high-significance asset-anchored Distribution (hexagon) event', async () => {
    const r = await svc.from('events').select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'asset')
      .eq('event_type_id', ET_DISTRIBUTION)
      .eq('significance', 'high');
    expect(r.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('company band: at least one pinned company-anchored event', async () => {
    const r = await svc.from('events').select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'company')
      .eq('visibility', 'pinned');
    expect(r.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('company band: a low-significance leadership event is feed-only (no high sig, not pinned)', async () => {
    const r = await svc.from('events')
      .select('significance, visibility')
      .eq('space_id', p.org.spaceId)
      .eq('anchor_type', 'company')
      .eq('event_type_id', ET_LEADERSHIP);
    expect(r.error).toBeNull();
    expect((r.data ?? []).some(e => e.significance !== 'high' && e.visibility === null)).toBe(true);
  });

  it('approval-to-distribution gap differs between two assets (comparison is meaningful)', async () => {
    const r = await svc.from('events')
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
      .filter(g => g.appr !== undefined && g.dist !== undefined)
      .map(g => (g.dist! - g.appr!));
    expect(spans.length).toBeGreaterThanOrEqual(2);
    // the two assets must have visibly different approval->distribution spans
    expect(Math.max(...spans) - Math.min(...spans)).toBeGreaterThan(180 * 24 * 3600 * 1000);
  });

  it('re-seeding is idempotent: event count unchanged', async () => {
    const before = await svc.from('events').select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);
    expectOk(await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId }));
    const after = await svc.from('events').select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);
    expect(after.count).toBe(before.count);
  });
});
```

Before relying on the import line, open `role-access.spec.ts` and copy its exact harness import specifier and exported helper names (`setupPersonas`, `as`, `expectOk`, and however it obtains a service-role client). Adjust the import line and the `serviceClient()` call to match the real harness API. Do not invent helpers that do not exist.

- [ ] **Step 2: Run the spec to verify it fails (red)**

Serialize against other DB sessions first (confirm no other session is mid `db reset` / integration run). Then, from `src/client`:

Run: `export $(supabase status -o env | xargs) >/dev/null 2>&1; SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d= -f2-) SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2-) npx vitest run integration/tests/seed-demo-feature-coverage.spec.ts`

Expected: FAIL on "asset lanes" and "company band pinned" assertions, because the current seed anchors nothing to assets and pins no company event. (The "seeds events" and "idempotent" cases may already pass; the asset-lane and pinned cases must fail.) If the harness import fails to resolve, fix the import to match `role-access.spec.ts` and re-run until the failure is the assertion failure, not a module-resolution error.

- [ ] **Step 3: Commit the failing spec**

```bash
git add src/client/integration/tests/seed-demo-feature-coverage.spec.ts
git commit -m "test(seed-demo): assert asset-lane + company-band feature coverage and fresh-owner idempotency"
```

---

### Task 2: Migration redefining `_seed_demo_events` with asset-lane + company-band coverage

**Files:**
- Create: `supabase/migrations/20260629060000_seed_demo_feature_coverage.sql`

**Interfaces:**
- Consumes: `_seed_ids` temp table populated by the orchestrator (`entity_type='company'` and `entity_type='product'` rows); `public.events` / `public.event_sources` schema; system event-type UUIDs.
- Produces: a redefined `public._seed_demo_events(p_space_id uuid, p_uid uuid)` that, in addition to the existing business-event landscape, seeds asset-anchored Approval + Distribution events on Wegovy / Zepbound / Attruby and company-band Leadership events (one pinned, one feed-only).

- [ ] **Step 1: Capture the live definition as the base**

Run (from repo root, local Supabase running):

```bash
PGURL=$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')
psql "$PGURL" -At -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_seed_demo_events' limit 1;"
```

Copy the emitted `CREATE OR REPLACE FUNCTION ...` verbatim into the new migration file. This is the base; do not reconstruct from `20260628290000`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260629060000_seed_demo_feature_coverage.sql`. Header comment, then the live-based `create or replace`, with exactly these changes to the live body:

1. In the `declare` block, add asset id lookups (assets are `entity_type='product'` in `_seed_ids`):

```sql
  a_wegovy   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  a_zepbound uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  a_attruby  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');
```

and add the asset-lane / company-band event-type constants alongside the existing `et_*` constants:

```sql
  et_launch_dist constant uuid := 'a0000000-0000-0000-0000-000000000040'; -- Distribution (hexagon)
  et_leadership  constant uuid := 'a0000000-0000-0000-0000-000000000050'; -- Leadership Change (low default sig)
```

(`et_approval` = `a0000000-0000-0000-0000-000000000035` and `et_strategic` already exist in the live declare block; reuse them.)

2. **Re-anchor the existing Attruby commercial-launch Distribution event** from the company to the asset (one edit, no duplicate fact). In the live body the insert reads `... 'high', 'company', c_atlas, ...) returning id into v_attruby_launch;`. Change its anchor to the asset:

```sql
  -- Multi-source event A: BridgeBio Attruby commercial launch (Distribution).
  -- Re-anchored company -> asset: a commercial distribution fact belongs on the
  -- asset lane (spec: asset lane hosts approval / launch / LOE / distribution).
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata)
    values (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'BridgeBio Attruby commercial launch',
      'actual', '2024-12-09', 'exact', 'BridgeBio launches Attruby (acoramidis) for ATTR-CM, second-to-market entrant against Pfizer Vyndaqel.',
      'high', 'asset', a_attruby, jsonb_build_object('source','analyst'))
    returning id into v_attruby_launch;
```

(The two `event_sources` inserts for `v_attruby_launch` stay unchanged; provenance is preserved.)

3. **Append a new block** at the end of the function body, just before the final `end;`, after the existing `if t_redefine_2 is not null ... end if;` block:

```sql
  -- =========================================================================
  -- ASSET-LANE COMMERCIAL TIMELINE (feature coverage: asset lanes + comparison).
  -- Each asset gets an asset-anchored Approval (flag) and a later asset-anchored
  -- Distribution (hexagon). anchor_type='asset' is required to render on the
  -- asset lane (no roll-up from trials). The approval-to-distribution gap is
  -- deliberately wide for Wegovy (supply-constrained launch) and narrow for
  -- Zepbound (record-fast ramp) so the two-asset comparison reads at a glance.
  -- These are distinct asset/commercial milestones, not copies of the trial-
  -- anchored regulatory markers in _seed_demo_markers.
  -- =========================================================================
  if a_wegovy is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Wegovy reaches market in obesity',
        'actual', '2021-06-04', 'exact', 'Semaglutide 2.4 mg cleared for chronic weight management, opening the asset for commercial distribution.',
        'high', 'asset', a_wegovy, jsonb_build_object('source','analyst')),
      (gen_random_uuid(), p_space_id, p_uid, et_launch_dist, 'Wegovy broad US distribution restored',
        'actual', '2023-05-01', 'exact', 'After roughly two years of supply-constrained rollout, Wegovy returns to broad US pharmacy distribution across all dose strengths.',
        'high', 'asset', a_wegovy, jsonb_build_object('source','analyst'));
  end if;

  if a_zepbound is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Zepbound reaches market in obesity',
        'actual', '2023-11-08', 'exact', 'Tirzepatide cleared for chronic weight management, opening the asset for commercial distribution.',
        'high', 'asset', a_zepbound, jsonb_build_object('source','analyst')),
      (gen_random_uuid(), p_space_id, p_uid, et_launch_dist, 'Zepbound broad US distribution',
        'actual', '2024-02-01', 'exact', 'Zepbound reaches broad US pharmacy distribution within roughly three months of clearance, the fastest cardiometabolic launch ramp on record.',
        'high', 'asset', a_zepbound, jsonb_build_object('source','analyst'));
  end if;

  -- Attruby asset-anchored approval to complete its lane (its distribution event
  -- was re-anchored to the asset above). Fast second-to-market entrant.
  if a_attruby is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Attruby reaches market in ATTR-CM',
        'actual', '2024-11-22', 'exact', 'Acoramidis cleared for ATTR cardiomyopathy, entering a Vyndaqel-saturated market.',
        'high', 'asset', a_attruby, jsonb_build_object('source','analyst'));
  end if;

  -- =========================================================================
  -- COMPANY BAND coverage: a feed-only low-significance leadership event, and a
  -- pinned low-significance event promoted onto the company band. Leadership
  -- Change (a0..050) defaults to low significance, so visibility drives the band.
  -- =========================================================================
  if c_meridian is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, visibility, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_leadership, 'Lilly names new chief commercial officer',
        'actual', '2024-02-15', 'exact', 'Leadership change in the Lilly cardiometabolic commercial organization.',
        null, null, 'company', c_meridian, jsonb_build_object('source','analyst'));  -- low sig, feed-only
  end if;

  if c_vantage is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, visibility, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_leadership, 'Novo Nordisk announces CEO succession',
        'actual', '2024-08-01', 'exact', 'Analyst-pinned leadership transition at Novo Nordisk during the GLP-1 supply ramp.',
        null, 'pinned', 'company', c_vantage, jsonb_build_object('source','analyst'));  -- low sig, pinned onto band
  end if;
```

Then end the file with an in-file smoke and the schema reload (next step). Do **not** add `et_leadership` / `et_launch_dist` twice if a same-named constant already exists in the live declare block; reconcile against the captured base.

- [ ] **Step 3: Append the in-file smoke and schema reload**

Model the smoke on the C5 migration's `do $smoke$ ... $smoke$` block (data-conditional, self-cleaning, prod-safe; skips on a non-seeded DB). It must seed a scratch space through the producer chain and assert the new coverage, then clean up. End the migration with `notify pgrst, 'reload schema';`.

```sql
do $smoke$
declare
  v_tenant uuid;
  v_uid    uuid;
  v_space  uuid := gen_random_uuid();
  v_asset_pairs int;
  v_pinned int;
  v_feed_leadership int;
  v_hex_asset int;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tenant is null or v_uid is null
     or not exists (select 1 from public.spaces where id = '00000000-0000-0000-0000-0000000d0100') then
    raise notice 'seed-demo feature-coverage smoke: skipped on non-seeded db; covered by integration suite';
    return;
  end if;

  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'seed-demo coverage smoke', v_uid);

  create temp table if not exists _seed_ids (
    entity_type text not null, key text not null, id uuid not null,
    primary key (entity_type, key)
  ) on commit drop;
  delete from _seed_ids;

  perform public._seed_demo_companies(v_space, v_uid);
  perform public._seed_demo_indications(v_space, v_uid);
  perform public._seed_demo_assets(v_space, v_uid);
  perform public._seed_demo_moa_roa(v_space, v_uid);
  perform public._seed_demo_trials(v_space, v_uid);
  perform public._seed_demo_asset_indications(v_space, v_uid);
  perform public._seed_demo_markers(v_space, v_uid);
  perform public._seed_demo_events(v_space, v_uid);

  -- >= 2 assets with both an asset-anchored Approval and Distribution
  select count(*) into v_asset_pairs from (
    select anchor_id from public.events
    where space_id = v_space and anchor_type = 'asset'
      and event_type_id in ('a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-000000000040')
    group by anchor_id
    having count(distinct event_type_id) = 2
  ) q;
  if v_asset_pairs < 2 then
    raise exception 'coverage smoke: expected >=2 assets with approval+distribution, got %', v_asset_pairs;
  end if;

  select count(*) into v_hex_asset from public.events
   where space_id = v_space and anchor_type = 'asset'
     and event_type_id = 'a0000000-0000-0000-0000-000000000040' and significance = 'high';
  if v_hex_asset < 1 then
    raise exception 'coverage smoke: expected >=1 high-sig asset Distribution, got %', v_hex_asset;
  end if;

  select count(*) into v_pinned from public.events
   where space_id = v_space and anchor_type = 'company' and visibility = 'pinned';
  if v_pinned < 1 then
    raise exception 'coverage smoke: expected >=1 pinned company event, got %', v_pinned;
  end if;

  select count(*) into v_feed_leadership from public.events
   where space_id = v_space and anchor_type = 'company'
     and event_type_id = 'a0000000-0000-0000-0000-000000000050'
     and visibility is null and (significance is null or significance <> 'high');
  if v_feed_leadership < 1 then
    raise exception 'coverage smoke: expected >=1 feed-only leadership event, got %', v_feed_leadership;
  end if;

  delete from public.spaces where id = v_space;
  raise notice 'seed-demo coverage smoke PASS: % asset pairs, % hex asset, % pinned, % feed leadership',
    v_asset_pairs, v_hex_asset, v_pinned, v_feed_leadership;
end;
$smoke$;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Apply the migration (serialized) and confirm the in-file smoke passes**

Confirm no other DB-heavy session is mid-run. Then from repo root:

Run: `supabase db reset`
Expected: completes without error; among the notices, `seed-demo coverage smoke PASS: ...` (or the `skipped on non-seeded db` notice if `db reset` runs the migration before `seed.sql`; in that case the integration spec in Step 5 is the gate).

- [ ] **Step 5: Run the new spec to verify it passes (green)**

From `src/client`, in isolation:

Run: `SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d= -f2-) SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2-) npx vitest run integration/tests/seed-demo-feature-coverage.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit the migration**

```bash
git add supabase/migrations/20260629060000_seed_demo_feature_coverage.sql
git commit -m "feat(seed-demo): seed asset-lane commercial events + company-band coverage for the events timeline"
```

---

### Task 3: Regenerate docs, run full gate suite, and verify the timeline renders

**Files:**
- Modify (regen, committed): `docs/runbook/*` auto-gen blocks via `npm run docs:arch`

**Interfaces:**
- Consumes: the green state from Tasks 1-2.
- Produces: a fully gated branch ready for PR/merge.

- [ ] **Step 1: Keep `role-access.spec.ts` green (no shape regression)**

From `src/client`, in isolation:

Run: `SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d= -f2-) SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2-) npx vitest run integration/tests/role-access.spec.ts`
Expected: PASS (the seeder still gates owner/admin-only and stays idempotent; the new events do not change gate behavior).

- [ ] **Step 2: Lint and build the client**

Run: `cd src/client && ng lint && ng build`
Expected: both pass with no new errors.

- [ ] **Step 3: Unit tests**

Run: `cd src/client && npm run test:units`
Expected: PASS.

- [ ] **Step 4: Full integration suite (serialized, isolated)**

Confirm no other DB-heavy session is active. From `src/client`:

Run: `SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d= -f2-) SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2-) npm run test:integration`
Expected: PASS. If a flake appears that is unrelated to seed-demo (e.g. personas teardown on leftover state), re-run in isolation per the shared-DB memory notes before concluding.

- [ ] **Step 5: Grants and features drift checks**

Run: `cd src/client && npm run grants:check && npm run features:check`
Expected: both pass. (No new tables or RPCs are introduced, so no grant matrix or feature-manifest change should be required. If `features:check` flags the redefined function, map it the same way `_seed_demo_events` is already mapped.)

- [ ] **Step 6: Regenerate architecture docs and Supabase advisors**

Run: `cd src/client && npm run docs:arch`
Then from repo root: `supabase db advisors --local --type all`
Expected: `docs:arch` updates only auto-gen blocks (migrations changed); advisors report no new warnings attributable to this migration.

- [ ] **Step 7: Commit the regen**

```bash
git add docs/runbook
git commit -m "docs(arch): regenerate after seed-demo feature-coverage migration"
```

- [ ] **Step 8: Manual timeline verification on a fresh space**

Seed a brand-new empty space owned by the test user and load the redesigned timeline (per the project's local-auth Playwright / browser pattern). Confirm without any hand-augmentation:
- Asset lanes render Approval (flag) and Distribution (hexagon) glyphs for Wegovy / Zepbound / Attruby.
- At `detailLevel='assets'` (the merged Compare preset), two asset lanes stack and the Wegovy approval-to-distribution span is visibly wider than Zepbound's.
- The company band shows the pinned Novo CEO-succession event; the Lilly CCO leadership event is feed-only (no band glyph) and appears in the intelligence feed.

Record the outcome (screenshot or a short note of what rendered). If a surface does not render, treat it as a `showsOnRow` mismatch and debug the anchor/visibility/significance of the offending event before claiming completion.

- [ ] **Step 9: Finish the branch**

Use superpowers:finishing-a-development-branch. Merge `develop` into the branch first and resolve any conflicts; then open a PR or merge to `develop` (no `gh pr merge --auto`; use `--merge` / `--admin`). Do not push the other sessions' branches.

---

## Self-Review

**Spec coverage:** Task item 1 (live-based redefinition + `notify pgrst`) → Task 2 Steps 1-3. Item 2 (model-fit audit, repoint old-model writes) → covered by the audit (chain already on-model); the one anchoring correction (Attruby distribution company->asset) is in Task 2 Step 2. Item 3 (owner gating + idempotency + any-space) → already present and asserted; the new spec (Task 1) proves a fresh non-admin owner's space and idempotency. Item 4 (feature coverage: company band, hexagon on asset lanes, significance high/low, two-asset approval-to-distribution comparison) → Task 2 Step 2 block + Task 1 assertions + Task 3 Step 8 visual check. Item 5 (update dependent specs + add fresh-owner idempotency spec) → `role-access.spec.ts` kept green (Task 3 Step 1); `event-producers.integration.spec.ts` does not exist (audit); new composition spec added (Task 1).

**Placeholder scan:** No TBD/TODO. Every SQL and TS step shows concrete content. The only deliberately deferred specifics are the harness import specifier in Task 1 (instructed to copy from `role-access.spec.ts` at implementation time) and the verbatim live-definition capture in Task 2 Step 1 (must be taken from the running DB, not transcribed here, per the live-base constraint).

**Type/identifier consistency:** Event-type UUIDs are identical across the spec (`ET_*`), the migration constants (`et_*`), and the smoke (`a0..035`/`040`/`050`). Asset lookups use `entity_type='product'` consistently; `events.anchor_type='asset'` consistently. `significance` ∈ {high, low, null}, `visibility` ∈ {pinned, hidden, null} match the live check constraints. The migration version `20260629060000` is clear of develop (`...030000`), Stage 3 (`...040000`/`040100`), and import (`...050000+`).
