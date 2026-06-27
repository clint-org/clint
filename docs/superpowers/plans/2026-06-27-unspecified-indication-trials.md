# Unspecified-Indication Trials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trial created without an indication still appears in the timeline (under a read-side "Unspecified" node), and users are nudged to classify it via a dialog note and an "Unclassified" column affordance.

**Architecture:** Read-side only. `get_dashboard_data` gains a synthetic per-asset indication node (`id: null`, `is_unspecified: true`) that collects trials with no mapped indication, so orphan trials flow through the existing client mapper onto normal timeline rows. The client mapper folds those trials in with an empty `_indications` array (no fake chip); the indication column's empty branch becomes a tooltipped "Unclassified" affordance. The trial create/edit dialogs show a non-blocking footer note when no indication is selected.

**Tech Stack:** Supabase/Postgres (plpgsql, SECURITY INVOKER `get_dashboard_data`), Angular 19 standalone + signals, PrimeNG 21, Tailwind v4, Vitest.

## Global Constraints

- Source of truth for the spec: `docs/superpowers/specs/2026-06-27-unspecified-indication-trials-design.md`.
- **No junk taxonomy rows.** The "Unspecified" node is synthesized in the query only; never insert an indication/condition/asset_indication record for it.
- **Build SQL from live state, not migration files.** `get_dashboard_data` has been redefined multiple times (latest base `20260616120100_dashboard_data_marker_range_fields.sql`, possibly newer). Before editing, dump the live body with `pg_get_functiondef` and base the new definition on that. Redefining from an old migration silently reverts newer logic (`has_intelligence`, marker range fields, etc.).
- End any migration that changes an RPC body with `notify pgrst, 'reload schema';` (project convention).
- Angular client rules in `src/client/CLAUDE.md` apply: standalone + OnPush, `inject()`, signals/`computed()`, native control flow (`@if`/`@for`), `pTooltip` (never `title=`), `bg-brand-*` not `bg-teal-*`, slate is a hard-coded data color, no em-dashes anywhere (including `&mdash;`).
- Lint+build gate: `cd src/client && ng lint && ng build`. Unit tests: `npm run test:units`. After any migration: `supabase db reset` then `supabase db advisors --local --type all`.
- Local DB is shared across worktrees; apply schema via `supabase db reset` (not ad-hoc psql) and expect transient contention.

---

## File Structure

- `supabase/migrations/<ts>_dashboard_unspecified_indication_node.sql` (new) — helper `_dashboard_trial_obj` + redefined `get_dashboard_data` + smoke + schema reload.
- `src/client/src/app/core/services/dashboard.service.ts` (modify) — fold synthetic-node trials into the flat list with empty `_indications`.
- `src/client/src/app/core/services/dashboard.service.spec.ts` (new or modify) — mapper unit tests.
- `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html` (modify) — replace em-dash placeholder with `Unclassified` affordance + tooltip.
- `src/client/src/app/features/manage/trials/trial-create-dialog.component.{ts,html}` (modify) — footer note when indication empty.
- `src/client/src/app/features/manage/trials/trial-edit-dialog.component.{ts,html}` (modify) — footer note when indication empty.

---

## Task 1: Backend — synthetic "Unspecified" node in `get_dashboard_data`

**Files:**
- Create: `supabase/migrations/<ts>_dashboard_unspecified_indication_node.sql`

**Interfaces:**
- Produces (consumed by the RPC JSON shape, read by Task 2's mapper): each asset's `indications` array MAY contain one extra element shaped exactly like a real indication element, with `id: null`, `name: "Unspecified"`, `is_unspecified: true`, `development_status: null`, and a `trials` array of the asset's orphan trials. Real indication elements are unchanged and gain `"is_unspecified": false`.
- Produces (helper): `public._dashboard_trial_obj(p_trial public.trials, p_space_id uuid, p_start_year int, p_end_year int) returns jsonb` — returns the per-trial JSON object (markers, recent-change rollup, notes, phase_data, intelligence fields) identical to what the current inline lateral builds.

- [ ] **Step 1: Capture the live function definition**

Run (from repo root, local Supabase running):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At \
  -c "select pg_get_functiondef('public.get_dashboard_data(uuid,uuid[],uuid[],uuid[],int,int,text[],text[],text[],uuid[],uuid[])'::regprocedure);" \
  > /private/tmp/claude-501/-Users-aadityamadala-Documents-code-clint-v2/cd0ec20b-0357-4990-a6ac-3786e4fd06c9/scratchpad/gdd_live.sql
```
Expected: a complete `CREATE OR REPLACE FUNCTION public.get_dashboard_data(...)` body. This is the base you edit — do NOT start from a migration file. Read it fully; locate the `trials` sub-select (the `select jsonb_agg(trial_obj order by t.display_order) from ( ... ) t ... cross join lateral ( select jsonb_build_object('id', t.id, ...) as trial_obj )` block) and the surrounding `indications` `jsonb_agg(indication_obj ...)` built from `asset_indications ai join indications ind`.

- [ ] **Step 2: Write the new migration file**

Create `supabase/migrations/<ts>_dashboard_unspecified_indication_node.sql` (use a timestamp later than every existing migration; check `ls supabase/migrations | tail -1`). The migration has four parts:

1. **Helper `_dashboard_trial_obj`.** Extract the inline `trial_obj` `jsonb_build_object(...)` (the one that builds `id/name/acronym/identifier/status/notes/display_order/asset_id/recruitment_status/study_type/phase/ctgov_last_synced_at/recent_changes_count/.../phase_data/markers/trial_notes/has_intelligence/intelligence_headline` and whatever else the live body emits) into:

```sql
create or replace function public._dashboard_trial_obj(
  p_trial public.trials,
  p_space_id uuid,
  p_start_year int,
  p_end_year int
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- BODY: copy the live trial_obj construction verbatim, replacing the
  -- correlated `t` with `p_trial` and reusing p_space_id/p_start_year/p_end_year.
  -- This includes the recent-change rollup lateral and the markers/notes
  -- sub-selects exactly as they appear live. Return the single jsonb object.
  select jsonb_build_object( ... );
$$;
```
Build this body from `gdd_live.sql` so no fields are dropped. Verify field-for-field against the live block.

2. **Redefine `get_dashboard_data`** from the live body with two edits:
   - Replace the inline `trial_obj` lateral in the real-indication branch with a call to `public._dashboard_trial_obj(t, p_space_id, p_start_year, p_end_year)`.
   - Add `'is_unspecified', false` to each real `indication_obj`.
   - Change the asset's `indications` value from `jsonb_agg(indication_obj order by ind.display_order, ind.name)` over only real indications to a UNION of the real-indication rows and **one synthetic row per asset**, emitted only when orphan trials exist AND no indication filter is active:

```sql
-- inside the asset lateral, replacing the existing `'indications', coalesce((...), '[]'::jsonb)`
'indications', (
  select coalesce(jsonb_agg(ind_obj order by sort_key, ind_name), '[]'::jsonb)
  from (
    -- real indications (existing query), each tagged is_unspecified=false
    select 0 as sort_key, ind.name as ind_name,
           jsonb_build_object(
             'id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation,
             'is_unspecified', false,
             'development_status', ai.development_status,
             'development_status_source', ai.development_status_source,
             'trials', coalesce((
               select jsonb_agg(public._dashboard_trial_obj(t, p_space_id, p_start_year, p_end_year)
                                order by t.display_order)
               from (
                 select distinct on (t.id) t.*
                 from public.trials t
                 join public.trial_assets ta on ta.trial_id = t.id
                 join public.trial_conditions tc on tc.trial_id = t.id
                 join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                 where ta.asset_id = a.id and t.space_id = p_space_id
                   and cim.indication_id = ind.id
                   and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                   and (p_study_types is null or t.study_type = any(p_study_types))
                   and (p_phases is null or t.phase_type = any(p_phases))
                 order by t.id
               ) t
             ), '[]'::jsonb)
           ) as ind_obj
    from public.asset_indications ai
    join public.indications ind on ind.id = ai.indication_id
    where ai.asset_id = a.id and ai.space_id = p_space_id
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))

    union all

    -- synthetic Unspecified node: only when no indication filter and orphans exist
    select 1 as sort_key, '' as ind_name,
           jsonb_build_object(
             'id', null, 'name', 'Unspecified', 'abbreviation', null,
             'is_unspecified', true,
             'development_status', null,
             'development_status_source', null,
             'trials', coalesce((
               select jsonb_agg(public._dashboard_trial_obj(t, p_space_id, p_start_year, p_end_year)
                                order by t.display_order)
               from (
                 select distinct on (t.id) t.*
                 from public.trials t
                 join public.trial_assets ta on ta.trial_id = t.id
                 where ta.asset_id = a.id and t.space_id = p_space_id
                   and not exists (
                     select 1 from public.trial_conditions tc
                     join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                     where tc.trial_id = t.id
                   )
                   and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                   and (p_study_types is null or t.study_type = any(p_study_types))
                   and (p_phases is null or t.phase_type = any(p_phases))
                 order by t.id
               ) t
             ), '[]'::jsonb)
           ) as ind_obj
    where p_indication_ids is null
      and exists (
        select 1 from public.trials t2
        join public.trial_assets ta2 on ta2.trial_id = t2.id
        where ta2.asset_id = a.id and t2.space_id = p_space_id
          and not exists (
            select 1 from public.trial_conditions tc2
            join public.condition_indication_map cim2 on cim2.condition_id = tc2.condition_id
            where tc2.trial_id = t2.id
          )
      )
  ) s
)
```
Keep every other part of the live body byte-for-byte. Match the live function's `security` and `set search_path` clauses.

3. **Schema reload:** end the file with `notify pgrst, 'reload schema';`

4. **Smoke test** (Step 4 below) appended to the same migration as a `do $$ ... $$;` block.

- [ ] **Step 3: Apply and run advisors**

Run:
```bash
supabase db reset
supabase db advisors --local --type all
```
Expected: reset completes through the new migration with the smoke `raise notice` printing; advisors report no NEW warnings attributable to `_dashboard_trial_obj` (a `stable`/`search_path=''` SQL helper is clean).

- [ ] **Step 4: Smoke test (in the migration)**

Append this block before the final `notify`:
```sql
do $$
declare
  v_owner   uuid := 'cccc9999-0001-0001-0001-cccccccc0001';
  v_agency  uuid := 'cccc9999-0002-0002-0002-cccccccc0002';
  v_tenant  uuid := 'cccc9999-0003-0003-0003-cccccccc0003';
  v_space   uuid := 'cccc9999-0004-0004-0004-cccccccc0004';
  v_company uuid := 'cccc9999-0005-0005-0005-cccccccc0005';
  v_asset   uuid := 'cccc9999-0006-0006-0006-cccccccc0006';
  v_classified uuid;
  v_orphan     uuid;
  v_result  jsonb;
  v_orphan_in_unspec boolean;
  v_orphan_in_real   boolean;
  v_classified_in_unspec boolean;
  v_suppressed boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'unspec-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Unsp', 'unsp', 'unsp', 'Unsp', 'u@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'Unsp', 'unsp-t', 'unspt', 'Unsp');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'Unsp Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset, v_space, v_owner, v_company, 'UnspAsset');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  -- classified trial (indication provided) and orphan trial (no indication)
  v_classified := public.create_trial(v_space, v_asset, 'Classified Trial', 'NCT-UNSP-001', 'Active', 'P3', null, null, 'Unsp Obesity', null);
  v_orphan     := public.create_trial(v_space, v_asset, 'Orphan Trial',     'NCT-UNSP-002', 'Active', 'P2', null, null, null,          null);

  v_result := public.get_dashboard_data(v_space);

  v_orphan_in_unspec := jsonb_path_exists(v_result,
    ('$[*].assets[*] ? (@.id == "' || v_asset || '").indications[*] ? (@.is_unspecified == true).trials[*] ? (@.id == "' || v_orphan || '")')::jsonpath);
  v_orphan_in_real := jsonb_path_exists(v_result,
    ('$[*].assets[*] ? (@.id == "' || v_asset || '").indications[*] ? (@.is_unspecified == false).trials[*] ? (@.id == "' || v_orphan || '")')::jsonpath);
  v_classified_in_unspec := jsonb_path_exists(v_result,
    ('$[*].assets[*] ? (@.id == "' || v_asset || '").indications[*] ? (@.is_unspecified == true).trials[*] ? (@.id == "' || v_classified || '")')::jsonpath);

  if not v_orphan_in_unspec then raise exception 'unspec FAIL: orphan trial not under Unspecified node'; end if;
  if v_orphan_in_real then raise exception 'unspec FAIL: orphan trial leaked into a real indication'; end if;
  if v_classified_in_unspec then raise exception 'unspec FAIL: classified trial wrongly under Unspecified'; end if;

  -- filter suppression: filtering to a specific indication must hide the Unspecified node
  v_suppressed := not jsonb_path_exists(
    public.get_dashboard_data(v_space, null, null,
      (select array_agg(indication_id) from public.asset_indications where asset_id = v_asset)),
    ('$[*].assets[*].indications[*] ? (@.is_unspecified == true)')::jsonpath);
  if not v_suppressed then raise exception 'unspec FAIL: Unspecified node not suppressed under indication filter'; end if;

  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'unspec smoke ok: orphan visible under Unspecified, classified unaffected, filter suppresses';
end $$;
```
Re-run `supabase db reset`. Expected: the `unspec smoke ok` notice prints and the reset succeeds. If any `raise exception` fires, fix the query and re-reset.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<ts>_dashboard_unspecified_indication_node.sql
git commit -m "feat(dashboard): surface indication-less trials under an Unspecified node"
```

---

## Task 2: Frontend — fold orphan trials into the flat list with empty `_indications`

**Files:**
- Modify: `src/client/src/app/core/services/dashboard.service.ts:71-120`
- Test: `src/client/src/app/core/services/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: the Task 1 RPC shape — each asset's `indications[]` may include an element with `is_unspecified: true` and `id: null`.
- Produces: per-asset `trials[]` includes orphan trials; orphan trials carry `_indications: []` (empty), real-indication trials are unchanged.

- [ ] **Step 1: Write the failing test**

Add to `dashboard.service.spec.ts` (create the file if absent; import `mapDashboardCompanies` from `./dashboard.service`):
```ts
import { describe, it, expect } from 'vitest';
import { mapDashboardCompanies } from './dashboard.service';

describe('mapDashboardCompanies — unspecified node', () => {
  const data = [{
    id: 'co1', name: 'Co', logo_url: null,
    assets: [{
      id: 'a1', name: 'Asset', indications: [
        { id: 'ind1', name: 'Obesity', is_unspecified: false,
          trials: [{ id: 't1', name: 'Classified', markers: [] }] },
        { id: null, name: 'Unspecified', is_unspecified: true,
          trials: [{ id: 't2', name: 'Orphan', markers: [] }] },
      ],
    }],
  }];

  it('folds orphan trials into the flat list', () => {
    const out = mapDashboardCompanies(data);
    const ids = out[0].assets[0].trials.map((t: any) => t.id);
    expect(ids).toEqual(['t1', 't2']);
  });

  it('gives orphan trials an empty _indications (no fake chip)', () => {
    const out = mapDashboardCompanies(data);
    const orphan = out[0].assets[0].trials.find((t: any) => t.id === 't2');
    expect(orphan._indications).toEqual([]);
  });

  it('keeps real indication refs on classified trials', () => {
    const out = mapDashboardCompanies(data);
    const classified = out[0].assets[0].trials.find((t: any) => t.id === 't1');
    expect(classified._indications).toEqual([
      { id: 'ind1', indication_id: 'ind1', indication_name: 'Obesity' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- dashboard.service`
Expected: FAIL — the orphan currently gets `_indications: [{ id: null, ... }]`, so the empty-array assertion fails (and the fold may already pass).

- [ ] **Step 3: Implement the mapper change**

In `mapDashboardCompanies`, change the indication loop so a synthetic node still contributes its trials but adds no `_indications` ref:
```ts
for (const ind of p.indications ?? []) {
  const isUnspecified = ind.is_unspecified === true || ind.id == null;
  const indicationRef = isUnspecified
    ? null
    : { id: ind.id, indication_id: ind.id, indication_name: ind.name };
  for (const t of ind.trials ?? []) {
    const existing = byTrialId.get(t.id);
    if (existing) {
      if (indicationRef) existing._indications.push(indicationRef);
    } else {
      byTrialId.set(t.id, { ...t, _indications: indicationRef ? [indicationRef] : [] });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/client && npm run test:units -- dashboard.service`
Expected: PASS (all three).

- [ ] **Step 5: Verify the no-indication-filter passthrough**

Read `filterDashboardData` (referenced in `dashboard.service.ts`; likely `core/services` or a sibling util) and confirm a trial with `_indications: []` is NOT dropped when `filters.indicationIds` is null/empty, and IS excluded when an indication filter is active. If it would wrongly drop empty-`_indications` trials with no active filter, add a guard (`if (!indicationIds?.length) keep;`). Add a Vitest case mirroring the discovered behavior. (If `filterDashboardData` already short-circuits on empty filter, no code change — just note it in the commit body.)

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/dashboard.service.ts src/client/src/app/core/services/dashboard.service.spec.ts
git commit -m "feat(dashboard): map unspecified-node trials onto rows with empty _indications"
```

---

## Task 3: Frontend — "Unclassified" indication-column affordance

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html:233-259`

**Interfaces:**
- Consumes: `row.trialIndications` (array; empty for orphan trials after Task 2).

- [ ] **Step 1: Replace the empty-state placeholder**

In the indication column block, the `@else` branch currently renders:
```html
} @else {
  <span class="text-slate-400 text-[10px]">&mdash;</span>
}
```
Replace it with a tooltipped, muted "Unclassified" affordance (no em-dash):
```html
} @else {
  <span
    class="inline-block rounded-sm bg-slate-50 text-slate-500 text-[10px] leading-tight px-1.5 py-0.5 italic"
    pTooltip="No indication set. Classify to group this trial."
    tooltipPosition="top"
    >Unclassified</span
  >
}
```
Confirm `Tooltip` from `primeng/tooltip` is already imported in `dashboard-grid.component.ts` imports array; if not, add it.

- [ ] **Step 2: Lint + build**

Run: `cd src/client && ng lint && ng build`
Expected: clean (no new errors).

- [ ] **Step 3: Manual browser verification**

Per `src/client/CLAUDE.md` §12, exercise the timeline: create a trial with no indication (or use existing data), open the dashboard with the indication column visible, and confirm the orphan trial renders a row with an "Unclassified" pill whose tooltip reads "No indication set. Classify to group this trial." Confirm a classified trial still shows its indication chip(s). Record what you observed in the commit body.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
git commit -m "feat(dashboard): show Unclassified affordance for indication-less trial rows"
```

---

## Task 4: Frontend — create/edit dialog footer note

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-create-dialog.component.ts` (add computed) and `...html:189` (note above `app-form-actions`)
- Modify: `src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts` (add computed) and `...html:28` (note above `app-form-actions`)

**Interfaces:**
- Consumes: each dialog's existing `indicationIds` signal/model (`trial-create-dialog.component.ts:72` `signal<string[]>([])`; `trial-edit-dialog` two-way binds `indicationIds`).
- Produces: a `protected readonly showNoIndicationNote = computed(() => this.indicationIds().length === 0)` on each dialog.

- [ ] **Step 1: Add the computed to the create dialog**

In `trial-create-dialog.component.ts`, near the other computeds, add:
```ts
protected readonly showNoIndicationNote = computed(() => this.indicationIds().length === 0);
```

- [ ] **Step 2: Add the footer note to the create dialog template**

In `trial-create-dialog.component.html`, immediately **above** `<app-form-actions ...>` (line 189), insert:
```html
@if (showNoIndicationNote()) {
  <p class="mb-3 text-[11px] leading-snug text-amber-700">
    No indication set. This trial will appear under <span class="italic">Unspecified</span>
    until you classify it.
  </p>
}
```

- [ ] **Step 3: Add the computed + note to the edit dialog**

In `trial-edit-dialog.component.ts`, add the same `showNoIndicationNote` computed over its `indicationIds`. In `trial-edit-dialog.component.html`, insert the same `@if (showNoIndicationNote()) { ... }` block immediately above `<app-form-actions ...>` (line 28). (The dialog already holds `indicationIds` — it two-way binds it to `app-trial-edit-form`.)

- [ ] **Step 4: Lint + build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 5: Manual browser verification**

Open the New-trial dialog: with no indication selected, the amber footer note appears directly above the Create button; selecting an indication hides it; save is never blocked. Repeat for the Edit dialog (clear all indications -> note appears). Record observations in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-create-dialog.component.ts \
        src/client/src/app/features/manage/trials/trial-create-dialog.component.html \
        src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts \
        src/client/src/app/features/manage/trials/trial-edit-dialog.component.html
git commit -m "feat(trials): footer note when creating/editing a trial without an indication"
```

---

## Task 5: Integration + docs sweep

**Files:**
- Possibly modify: runbook/help pages flagged by the stop-hook.

- [ ] **Step 1: Full verification**

Run from `src/client`: `ng lint && ng build && npm run test:units`. From repo root: `supabase db reset` (smoke passes) and `supabase db advisors --local --type all` (no new warnings).
Expected: all green.

- [ ] **Step 2: Docs/runbook drift**

If the runbook-review-guard stop-hook flags `06-backend-architecture.md` (RPC change) or a help page (e.g. markers/indications), update the hand-written prose accordingly and run `npm run docs:arch` from `src/client/` (regenerates auto-gen blocks; requires local Supabase up). Commit any regen in this change set, not as a follow-up.

- [ ] **Step 3: Final commit (if docs changed)**

```bash
git add -A docs
git commit -m "docs: note Unspecified-indication timeline behavior"
```

---

## Self-Review

- **Spec coverage:** Part 1 (synthetic node + suppression + helper) -> Task 1. Part 2 (dialog notes, create+edit) -> Task 4. Part 3 (mapper empty `_indications` + Unclassified column) -> Tasks 2 and 3. Testing (SQL smoke + Vitest mapper) -> Task 1 Step 4, Task 2 Steps 1-5. No spec section is unmapped.
- **Type consistency:** `is_unspecified` (snake_case) used in both the RPC JSON (Task 1) and the mapper check (Task 2). `showNoIndicationNote` used identically in both dialogs (Task 4). `_indications` empty-array contract is produced in Task 2 and consumed by Task 3's `row.trialIndications.length === 0` branch.
- **Placeholder scan:** the only "copy live body" directive (Task 1) is an intentional, mandatory deviation driven by the stale-base-clobber rule — the transformation recipe and call sites are fully specified; the smoke test and all frontend code are complete.
