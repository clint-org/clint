# Seed Demo Data Remodel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remodel the `seed_demo_data` event chain so every event renders on the correct lane (trial=clinical, asset=regulatory/commercial, company=corporate), with no duplicate facts, evergreen dates that keep projections ahead of today, and the full `actual`/`primary`/`company`/`forecasted` projection vocabulary across lanes.

**Architecture:** One new migration redefines the four event-producing helpers (`_seed_demo_markers`, `_seed_demo_events`, `_seed_demo_recent_activity`, `_seed_demo_activity_variety`) from their live definitions plus a one-line date-shift pass added to the `seed_demo_data` orchestrator. Producers keep their inline SECURITY DEFINER insert pattern (they must work for a platform-admin caller). A set of invariant tests in `seed-demo-feature-coverage.spec.ts` encodes every design rule and is the acceptance gate.

**Tech Stack:** PostgreSQL (Supabase migrations, plpgsql SECURITY DEFINER functions), Vitest + supabase-js integration tests.

**Spec:** `docs/superpowers/specs/2026-06-29-seed-demo-remodel-design.md` (read it first).

## Global Constraints

- No emojis; no em-dashes (use commas, colons, periods); no Claude attribution in code, comments, commits, or PR.
- Branch `feat/seed-demo-remodel` off current `origin/develop`, worktree `.worktrees/seed-demo-remodel`, `src/client/node_modules` symlinked.
- Shared local Supabase DB: take the DB token in `~/.clint-coordination/inbox.md` (post `DB-TAKE`, check the tail for an open take, post `DB-RELEASE` after) before any `supabase db reset` or integration run. Serialize.
- Base every `create or replace` on the LIVE `pg_get_functiondef` output, never an older migration copy. End the migration with `notify pgrst, 'reload schema'`.
- Only the producers' inline DEFINER inserts; do NOT call or redefine `create_event`/`update_event`/`get_event_detail`.
- Migration number: `20260629080000` (develop's highest is `20260629070000`; confirm clear of any in-flight coordination lane before authoring).
- Reference date constant baked into the seed: `R = date '2026-06-29'`.

## Lane taxonomy (the core rule, applied everywhere)

| Lane | `anchor_type` | Event types (system UUID) |
| --- | --- | --- |
| Trial (clinical) | `trial` | Trial Start `a0..011`, Trial End `a0..012`, Primary Completion `a0..008`, Topline Data `a0..013` |
| Asset (regulatory/commercial) | `asset` | Regulatory Filing `a0..032`, Approval `a0..035`, Launch `a0..036`, Distribution `a0..040`, LOE Date `a0..020` |
| Company (corporate) | `company` | Financial `a0..060`, Leadership Change `a0..050`, Strategic / M&A `a0..070` |

(`a0..0NN` = `a0000000-0000-0000-0000-0000000000NN`.) Assets are looked up from `_seed_ids` with `entity_type='product'`; insert asset events with `anchor_type='asset'`, `anchor_id = <product id>`.

## Projection-tier assignment

| Tier | When to use | Glyph (frontend) |
| --- | --- | --- |
| `actual` | Event happened (historical, date < R) | filled, no badge |
| `primary` | Projected from a primary source. Trial/clinical = CT.gov registry estimate; asset/company = a non-registry primary source | hollow, no letter on trials, `p` on asset/company (frontend follow-up) |
| `company` | Company has guided to the date | hollow + `c` |
| `forecasted` | Clint/analyst estimate (LOE, launch windows, far-out toplines) | hollow + `f`, dashed, dim |

Ensure at least one asset lane (Zepbound on the tirzepatide product) carries all four: a filled `actual` approval, a `company` projected filing, a `primary` projected milestone, an `f`-forecasted LOE.

---

### Task 1: Invariant tests (RED) + capture live definitions

**Files:**
- Modify: `src/client/integration/tests/seed-demo-feature-coverage.spec.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: the existing harness in that file (`buildPersonas`/`Personas` from `../fixtures/personas`, `as`/`expectOk` from `../harness/as`, `space_owner` persona, `p.org.spaceId`). Reuse exactly; do not add new harness helpers.
- Produces: failing invariant assertions that Task 2/3 must satisfy.

- [ ] **Step 1: Capture the live base definitions (reference for Task 2)**

Run from the worktree root (local Supabase running, DB at the branch base):
```bash
PGURL=$(supabase status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')
for fn in _seed_demo_markers _seed_demo_events _seed_demo_recent_activity _seed_demo_activity_variety seed_demo_data; do
  psql "$PGURL" -At -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$fn' limit 1;" > "/tmp/live_$fn.sql"
  echo "$fn: $(wc -l < /tmp/live_$fn.sql) lines"
done
```
These files are the authoring base for Task 2. Do not commit them.

- [ ] **Step 2: Write the failing invariant tests**

Append this block to `seed-demo-feature-coverage.spec.ts` (it reuses the file's existing imports and the `space_owner` persona pattern). The space-owner client can read all events in its space via RLS.

```ts
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
      .select('event_type_id, anchor_type, title, event_date, projection, significance, visibility')
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

  it('no two events share the same title', async () => {
    const seen = new Map<string, number>();
    for (const e of await rows()) seen.set(e.title, (seen.get(e.title) ?? 0) + 1);
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
});
```

Note: the `byAsset` map keys on `anchor_id`; add `anchor_id` to the `.select(...)` list in the `rows()` helper (change it to `'event_type_id, anchor_type, anchor_id, title, event_date, projection, significance, visibility'`).

- [ ] **Step 3: Run the tests to confirm they FAIL (RED)**

Post a `DB-TAKE`, then from `src/client`:
```bash
SUPABASE_URL=$(supabase status -o env | grep '^API_URL=' | cut -d= -f2- | tr -d '"') \
SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"') \
npx vitest run integration/tests/seed-demo-feature-coverage.spec.ts -t "remodel invariants"
```
Expected: FAIL on lane-correctness, duplicate-title, evergreen, and projection-vocabulary cases (current seed violates all of them). Post `DB-RELEASE`. If it fails on import resolution, fix the import to match the file's existing imports and re-run until failures are assertion failures.

- [ ] **Step 4: Commit the failing tests**

```bash
git add src/client/integration/tests/seed-demo-feature-coverage.spec.ts
git commit -m "test(seed-demo): remodel invariants - lane correctness, dedup, evergreen, projection variety"
```

---

### Task 2: Author the remodel migration

**Files:**
- Create: `supabase/migrations/20260629080000_seed_demo_remodel.sql`

**Interfaces:**
- Consumes: live defs captured in Task 1 Step 1; `_seed_ids` (`entity_type='company'` and `'product'` rows); `public.events`/`public.event_sources`.
- Produces: redefined `_seed_demo_markers`, `_seed_demo_events`, `_seed_demo_recent_activity`, `_seed_demo_activity_variety`, and `seed_demo_data` (orchestrator + date-shift only).

Base each `create or replace` on its `/tmp/live_<fn>.sql`. Apply the rules below. Keep all titles, descriptions, and the competitive landscape; only anchors, dedup, dates, and projection tiers change.

- [ ] **Step 1: Re-author `_seed_demo_markers` - split clinical (trial) vs regulatory/commercial (asset)**

Rules:
1. **Keep on the trial** (unchanged anchor): Trial Start, Trial End, Primary Completion, Topline Data inserts. Re-express their dates against `R` (they already are real absolute dates; leave them - the orchestrator shift handles evergreen).
2. **Move to the asset** every Approval (`a0..035`), Launch (`a0..036`), LOE (`a0..020`), Regulatory Filing (`a0..032`) insert. For each, replace `'trial', t_<trial>` with `'asset', a_<product>` where `a_<product>` is the trial's drug. Add the needed asset lookups to the declare block, e.g.:
   ```sql
   a_zepbound uuid := (select id from _seed_ids where entity_type='product' and key='p_zepbound');
   a_wegovy   uuid := (select id from _seed_ids where entity_type='product' and key='p_wegovy');
   -- ...one per asset referenced by a moved milestone
   ```
   Worked example (Approval): the current
   ```sql
   (gen_random_uuid(), p_space_id, p_uid, 'a0..035', 'Zepbound FDA approval (chronic weight management)','actual','2023-11-08','exact','...','trial', t_surmount_1, jsonb_build_object('source','analyst'))
   ```
   becomes
   ```sql
   (gen_random_uuid(), p_space_id, p_uid, 'a0..035', 'Zepbound FDA approval (chronic weight management)','actual','2023-11-08','exact','...','asset', a_zepbound, jsonb_build_object('source','analyst'))
   ```
3. **Dedup the fan-outs.** Where one milestone was inserted once per contributing trial (e.g. "Zepbound HFpEF sNDA filing (combined SUMMIT + SURMOUNT-1)" inserted for both `t_summit` and `t_surmount_1`), keep ONE insert anchored to the asset. Drop the duplicate rows.
4. **Projection tiers.** Historical milestones stay `actual`. For the projected regulatory/commercial events, assign tiers by provenance: company-guided filings -> `company`; analyst LOE dates and launch *windows* (range events) -> `forecasted`; a registry/primary-sourced projected milestone -> `primary`. Ensure Zepbound (a_zepbound) ends with at least one `actual` + one `company` + one `primary` + one `forecasted` event so the "full vocabulary" test passes.
5. The projected Topline Data events that drive "upcoming catalysts" stay trial-anchored (Topline is clinical) but get near-future dates via `R` (e.g. `R + interval '5 days'`) so the date-shift keeps them ~5 days ahead of today; these are the single source of truth for the upcoming-catalyst widget (see Task 2 Step 3).

- [ ] **Step 2: Re-author `_seed_demo_events` - corporate band + asset commercial**

Rules:
1. Corporate events (Strategic/Financial/Leadership, including M&A as Strategic) stay `anchor_type='company'`.
2. **Re-anchor** the "Wegovy SELECT label update for CV outcomes" Approval (`a0..035`) from `'company', c_vantage` to `'asset', a_wegovy` (it is an asset regulatory event, not corporate).
3. **Curated visibility:** set `visibility='pinned'` on the Roche/Carmot acquisition (Strategic), the "Lilly Mounjaro/Zepbound combined annual revenue exceeds $15B" (Financial), and one Leadership Change. Leave at least two corporate events with `visibility` null and low/`null` significance (feed-only).
4. Keep the two multi-source events and their `event_sources` rows (Attruby launch is a Distribution -> stays `anchor_type='asset'`, a_attruby, as in the merged migration; the Lilly revenue stays company).
5. Author dates against `R`; assign a `company` or `forecasted` projection to any projected corporate event so the company band shows a non-`actual` tier too.

- [ ] **Step 3: Re-author `_seed_demo_recent_activity` and `_seed_demo_activity_variety` - remove duplicate toplines**

Rules:
1. In `_seed_demo_recent_activity`: DELETE the block that inserts new "... topline expected" events (they duplicate the trial-anchored projected toplines from `_seed_demo_markers`). Keep the date-slip `update` statements that move existing projected events (re-express their anchors/dates against `R`). The upcoming-catalyst widget reads the markers' near-future projected toplines (Task 2 Step 1 rule 5).
2. In `_seed_demo_activity_variety`: keep the 12 CT.gov `trial_change_events` rows and the analyst change rows; DELETE any `insert into public.events` that creates a topline/approval fact-event duplicating a marker (the `m_live`, `m_finalized`, `m_doomed` demo events may stay only if their titles are unique and they do not duplicate an existing marker - prefer giving them unique titles or removing them). Author any retained event dates against `R`.
3. After this step, no event title is duplicated and no readout has both a "projected" and an "expected" copy.

- [ ] **Step 4: Add the date-shift pass to `seed_demo_data`**

Base on `/tmp/live_seed_demo_data.sql`. Keep the gating, idempotency, helper-call order, and the trailing `update public.trials set phase_type_source...` exactly. Append, as the final statements before the function end, the evergreen shift:
```sql
  -- Evergreen: shift the whole space so projections stay ahead of today.
  update public.events
     set event_date = current_date + (event_date - date '2026-06-29'),
         end_date   = case when end_date is not null
                           then current_date + (end_date - date '2026-06-29')
                           else null end
   where space_id = p_space_id;
```
Do not change anything else in the orchestrator.

- [ ] **Step 5: Add a remote-safe in-file smoke + schema reload**

Model on the smoke in `20260629060000_seed_demo_feature_coverage.sql`: guard so it SKIPS on a non-seeded db (no tenants/users or the local demo space absent), seed a scratch space through the producer chain, assert the remodel invariants (0 asset-types on trials, 0 duplicate titles, 0 stale projected, >=1 primary and >=1 forecasted on asset/company, >=1 pinned + >=1 feed-only company), delete the scratch space, and end the file with `notify pgrst, 'reload schema';`. Do not call gated RPCs.

- [ ] **Step 6: Commit the migration (not yet applied/verified)**

```bash
git add supabase/migrations/20260629080000_seed_demo_remodel.sql
git commit -m "feat(seed-demo): remodel events to correct lanes, dedup, evergreen dates, projection variety"
```

---

### Task 3: Apply, green the invariants, update dependents, full gates

**Files:**
- Modify: `src/client/integration/tests/event-producers.integration.spec.ts` (anchors moved by the remodel)
- Modify (regen, committed): `docs/runbook/*` via `npm run docs:arch`

- [ ] **Step 1: Apply on a clean DB (under the token)**

Post `DB-TAKE`. From the worktree root: `supabase db reset`. Expected: clean apply; the in-file smoke prints PASS or the non-seeded skip notice.

- [ ] **Step 2: Green the invariant tests**

From `src/client` (env vars as in Task 1 Step 3):
```bash
... npx vitest run integration/tests/seed-demo-feature-coverage.spec.ts
```
Expected: PASS (all remodel-invariant cases plus the retained asset-lane coverage cases). Iterate on the migration (re-edit, `db reset`, re-run) until green.

- [ ] **Step 3: Update and green `event-producers.integration.spec.ts`**

The remodel moves anchors the spec asserts on (e.g. the multi-source business events, any approval/topline anchors). Read the failures, update the expected `anchor_type` per title to the new lane (faithful update, not a weakening), and re-run:
```bash
... npx vitest run integration/tests/event-producers.integration.spec.ts
```
Expected: PASS. Then run `role-access.spec.ts` to confirm gating is unaffected; expected PASS.

- [ ] **Step 4: Full integration suite**

```bash
... npm run test:integration
```
Expected: PASS (0 failed). Re-run once on a transient gateway flake. Post `DB-RELEASE` when done with the DB-heavy work (keep the token through Steps 5-6 if running advisors/docs:arch, then release).

- [ ] **Step 5: Advisors, grants, features, docs**

```bash
supabase db advisors --local --type all          # expect: No issues found
cd src/client && npm run grants:check            # expect: PASS
npm run features:check; echo "EXIT=$?"           # expect: EXIT=0 (no new rpc-unmapped)
npm run docs:arch                                 # regenerates the migration drift list
```
Commit the runbook regen:
```bash
git add docs/runbook && git commit -m "docs(arch): regenerate after seed-demo remodel migration"
```

- [ ] **Step 6: Client gates**

```bash
cd src/client && ng lint && ng build
```
Expected: both pass.

- [ ] **Step 7: Visual verification on a fresh space**

Seed a brand-new space and load the timeline. Confirm without augmentation: regulatory/commercial markers sit on asset lanes (not trials); no duplicate markers; no projected markers behind the today line; the company band shows the pinned corporate events; an asset lane shows the filled/`c`/`f` projection treatments (the `p` letter awaits the frontend follow-up); bullseye and heatmap still populate (28-asset phase-centric landscape intact). Record the outcome.

- [ ] **Step 8: Finish the branch**

Use superpowers:finishing-a-development-branch. If a coordinator board is active, post a `READY` block (branch + head SHA + gate summary) and let the coordinator merge; otherwise open a PR or merge to `develop` (no `gh pr merge --auto`; use `--merge`/`--admin`). Then create the separate frontend follow-up task for the legend glyphs + `p`-badge rendering (`marker-visual.ts`).

---

## Self-Review

**Spec coverage:** Lane model -> Task 2 Steps 1-2 + Task 1 lane tests. Dedup -> Task 2 Steps 1(3)/3 + duplicate-title test. Evergreen dates -> Task 2 Step 4 + evergreen test. Projection variety -> Task 2 Steps 1(4)/2(5) + projection-vocabulary/full-tier tests. Corporate visibility -> Task 2 Step 2(3) + visibility test. New migration + smoke + tests -> Task 2 Step 5, Task 3. Dependent specs -> Task 3 Steps 2-3. Frontend legend/`p`-badge split out -> Task 3 Step 8 (not implemented here). Landscape unchanged -> only the four event helpers + orchestrator shift are touched.

**Placeholder scan:** No TBD/TODO. The migration body is authored from captured live defs by rule + worked example (a 180-event re-author is not transcribed line-by-line; the invariant tests and in-file smoke are the executable acceptance gate, and both are fully specified).

**Consistency:** Event-type UUIDs match between the lane table, the projection table, the tests, and the rules. `R = date '2026-06-29'` is identical in Task 2 Step 4 and the spec. Asset lookups use `entity_type='product'`; asset events use `anchor_type='asset'`. The `rows()` select list includes `anchor_id` (noted in Task 1 Step 2).
