# Trial Acronym in Dashboard RPCs and Trial Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trial acronyms surface on the dashboard grid, bullseye, landscape, event-form trial picker, and marker-form trial picker. The dashboard/bullseye RPCs currently drop `t.acronym` from their trial JSON, so the client's `acronym ?? name` fallback is always firing the verbose briefTitle. Trial pickers in dialogs display only `t.name`, drowning the user in CT.gov briefTitles.

**Architecture:**
1. **Backend.** A single migration recreates the dashboard / bullseye / landscape RPCs so each `jsonb_build_object` that emits a trial also emits `'acronym', t.acronym`. Mirrors the pattern from `20260528050000_feed_rpcs_prefer_trial_acronym.sql`. Inline smoke test inserts trials with and without acronyms and asserts the acronym field appears in each RPC's payload.
2. **Frontend.** A pure `toTrialOption(trial)` mapping function transforms a `Trial` into a `{ id, label, sublabel, identifier, companyName, assetName }` shape. The two trial pickers (`event-form` p-select, `marker-form` p-multiselect) consume this shape and render a two-line `pTemplate="item"` (label on top, `Company  ·  Asset  ·  NCT` muted below). The selected chip stays single-line for compactness.

**Tech Stack:** Supabase Postgres / plpgsql, Angular 19 (signals, standalone components), PrimeNG 21 (`p-select`, `p-multiselect`, `pTemplate`), Tailwind v4, Vitest.

**Trial-emitting RPCs to patch** (verified via grep for `jsonb_build_object` near `t.name`):
- `get_dashboard_data` (`supabase/migrations/20260502120900_dashboard_data_change_counts.sql:75-...`)
- `get_bullseye_landscape_index` (`supabase/migrations/20260524120600_rpcs_bullseye_landscape_index.sql:105-...`)
- `get_bullseye_by_company` (`supabase/migrations/20260524120600_rpcs_bullseye_landscape_index.sql:235-...`)
- `get_bullseye_by_moa` (`supabase/migrations/20260412120300_create_bullseye_by_moa.sql:104`)
- `get_bullseye_by_roa` (`supabase/migrations/20260412120400_create_bullseye_by_roa.sql:104`)
- `get_bullseye_assets` (`supabase/migrations/20260525120000_create_bullseye_assets_rpc.sql:209`)

**NOT patched** (intentional):
- `get_dashboard_inventory_snapshot` and `commit_source_import` inventory string. These are stable-hash inputs, not user-facing labels. Adding fields would invalidate cached proposals.

---

## File Structure

**Create:**
- `supabase/migrations/20260528130000_dashboard_rpcs_emit_trial_acronym.sql` (recreate the 6 RPCs above, add `'acronym', t.acronym` to each trial json, include smoke test)
- `src/client/src/app/core/utils/to-trial-option.ts` (pure mapping function)
- `src/client/src/app/core/utils/to-trial-option.spec.ts` (Vitest spec)

**Modify:**
- `src/client/src/app/features/events/event-form.component.ts` (swap `entityOptions` shape for trials to `TrialOption`; add `pTemplate="item"` + `pTemplate="selectedItem"` on the trial p-select; set `filterBy` for multi-field search)
- `src/client/src/app/features/manage/trials/marker-form.component.ts` (build `trialOptions` from `trials()` via `toTrialOption`; bind p-multiselect to that; add `pTemplate="item"` and `pTemplate="selectedItems"`; set `filterBy`)

**Not touched:**
- The dashboard grid template (`dashboard-grid.component.html`) already does `row.trial.acronym ?? row.trial.name` — once Task 1 lands, the fix flows through with zero client changes.
- Bullseye / landscape templates that already use `trial.acronym ?? trial.name` (e.g. `bullseye-detail-panel.component.html:133`).
- The `Trial` model — `acronym: string | null` is already defined (`trial.model.ts:10`).

---

## Task 1: Migration — add `acronym` to dashboard / bullseye / landscape RPCs

**Files:**
- Create: `supabase/migrations/20260528130000_dashboard_rpcs_emit_trial_acronym.sql`

**Approach:** This is a recreate-and-replace migration. For each RPC, copy the latest definition from the source migration, splice `'acronym', t.acronym,` into the trial `jsonb_build_object`, and re-emit the function with `create or replace`. Match the comment update pattern from `20260528050000`.

- [ ] **Step 1: Write the migration with all six RPC recreations and the smoke test**

```sql
-- migration: 20260528130000_dashboard_rpcs_emit_trial_acronym
-- purpose:  Surface trials.acronym in the dashboard, bullseye, and landscape
--          RPCs so the client-side `acronym ?? name` fallback can stop
--          firing on every row.
-- context: The events feed RPCs were updated in 20260528050000; the
--          dashboard/bullseye family was missed in that sweep.
-- depends on: 20260528003300 (trials.acronym column), 20260502120900,
--             20260524120600, 20260412120300, 20260412120400,
--             20260525120000
-- =============================================================================

-- =============================================================================
-- 1. get_dashboard_data: add 'acronym' to the per-trial jsonb_build_object
-- =============================================================================
-- (paste the full latest definition from 20260502120900_dashboard_data_change_counts.sql
--  with `'acronym', t.acronym,` inserted directly after `'name', t.name,`.)

-- =============================================================================
-- 2. get_bullseye_landscape_index
-- =============================================================================
-- (paste full latest definition from 20260524120600 with acronym spliced in)

-- =============================================================================
-- 3. get_bullseye_by_company
-- =============================================================================

-- =============================================================================
-- 4. get_bullseye_by_moa
-- =============================================================================

-- =============================================================================
-- 5. get_bullseye_by_roa
-- =============================================================================

-- =============================================================================
-- 6. get_bullseye_assets
-- =============================================================================

-- =============================================================================
-- smoke test: insert two trials, one with acronym, one without; run each RPC
-- and assert acronym appears (or is null) in the trial payload.
-- =============================================================================
do $$
declare
  v_agency_id      uuid := 'eeeeeeee-0001-0001-0001-eeeeeeeeee01';
  v_tenant_id      uuid := 'eeeeeeee-0002-0002-0002-eeeeeeeeee02';
  v_owner_id       uuid := 'eeeeeeee-0003-0003-0003-eeeeeeeeee03';
  v_space_id       uuid := 'eeeeeeee-0004-0004-0004-eeeeeeeeee04';
  v_company_id     uuid := 'eeeeeeee-0005-0005-0005-eeeeeeeeee05';
  v_asset_id       uuid := 'eeeeeeee-0006-0006-0006-eeeeeeeeee06';
  v_trial_a_id     uuid := 'eeeeeeee-0007-0007-0007-eeeeeeeeee07';
  v_trial_b_id     uuid := 'eeeeeeee-0008-0008-0008-eeeeeeeeee08';
  v_acronym        text := 'SURMOUNT-1';
  v_brief_title    text := 'A Study of Tirzepatide (LY3298176) in Participants With Obesity';
  v_payload        jsonb;
  v_trial          jsonb;
begin
  insert into auth.users (id, email)
    values (v_owner_id, 'dashboard-acronym-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'DA Smoke', 'da-smoke', 'dasmoke', 'DA', 'da@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'DA', 'da-smoke-t', 'dasmoket', 'DA');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'Lilly');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'Tirzepatide');

  insert into public.trials (id, space_id, created_by, asset_id, name, acronym, identifier)
    values (v_trial_a_id, v_space_id, v_owner_id, v_asset_id, v_brief_title, v_acronym, 'NCT99999901');

  insert into public.trials (id, space_id, created_by, asset_id, name, acronym, identifier)
    values (v_trial_b_id, v_space_id, v_owner_id, v_asset_id, 'Plain Trial With No Acronym', null, 'NCT99999902');

  -- 1. get_dashboard_data: acronym present for trial A, null for trial B
  set local request.jwt.claim.sub to 'eeeeeeee-0003-0003-0003-eeeeeeeeee03';
  v_payload := public.get_dashboard_data(v_space_id);
  select t into v_trial
  from jsonb_array_elements(v_payload) co,
       jsonb_array_elements(co -> 'products') p,
       jsonb_array_elements(p -> 'trials') t
  where t ->> 'id' = v_trial_a_id::text;
  if v_trial is null or v_trial ->> 'acronym' is distinct from v_acronym then
    raise exception 'get_dashboard_data: expected acronym=% on trial A, got %',
      v_acronym, v_trial;
  end if;

  select t into v_trial
  from jsonb_array_elements(v_payload) co,
       jsonb_array_elements(co -> 'products') p,
       jsonb_array_elements(p -> 'trials') t
  where t ->> 'id' = v_trial_b_id::text;
  if v_trial is null or (v_trial ? 'acronym') is false then
    raise exception 'get_dashboard_data: expected acronym key present on trial B (null value), got %', v_trial;
  end if;

  -- 2-6. Repeat the same `acronym = v_acronym` assertion for each bullseye
  --      RPC, drilling into the spoke/asset/trial path each one uses.
  --      (write each assertion verbatim — no helper extraction; the
  --      shapes differ and a helper would obscure the test.)

  raise notice 'dashboard_rpcs_emit_trial_acronym smoke ok';
end;
$$;
```

(The actual migration must paste the **full** latest definition of each of the 6 RPCs with `'acronym', t.acronym,` spliced in next to `'name', t.name,`. Use `git log --diff-filter=A -- supabase/migrations/<file>` if needed to locate the most recent recreation of each.)

- [ ] **Step 2: Reset the local DB and confirm the migration applies cleanly**

Run: `supabase db reset`
Expected: migration log ends with `dashboard_rpcs_emit_trial_acronym smoke ok` and no errors.

- [ ] **Step 3: Run the Supabase advisor**

Run: `supabase db advisors --local --type all`
Expected: no new warnings introduced by this migration. (Existing warnings from the baseline are fine.)

- [ ] **Step 4: Spot-check via psql that the dashboard RPC payload now contains `acronym`**

Run:
```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -c \
  "select jsonb_pretty(public.get_dashboard_data((select id from public.spaces limit 1))) limit 1;" \
  | head -40
```
Expected: at least one trial object in the output contains `"acronym": "..."`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260528130000_dashboard_rpcs_emit_trial_acronym.sql
git commit -m "Surface trial acronym in dashboard / bullseye / landscape RPCs"
```

---

## Task 2: `toTrialOption` utility + spec

**Files:**
- Create: `src/client/src/app/core/utils/to-trial-option.ts`
- Create: `src/client/src/app/core/utils/to-trial-option.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
// src/client/src/app/core/utils/to-trial-option.spec.ts
import { describe, expect, it } from 'vitest';
import type { Trial } from '../models/trial.model';
import { toTrialOption } from './to-trial-option';

function makeTrial(overrides: Partial<Trial> = {}): Trial {
  return {
    id: 't1',
    space_id: 's1',
    created_by: 'u1',
    asset_id: 'a1',
    name: 'A Study of Tirzepatide (LY3298176) in Participants With Obesity',
    acronym: 'SURMOUNT-1',
    identifier: 'NCT04184622',
    status: null,
    notes: null,
    display_order: 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    updated_by: null,
    phase_type: null,
    phase_start_date: null,
    phase_end_date: null,
    assets: { id: 'a1', name: 'Tirzepatide', companies: { id: 'c1', name: 'Lilly' } },
    ...overrides,
  };
}

describe('toTrialOption', () => {
  it('prefers acronym when present', () => {
    const opt = toTrialOption(makeTrial());
    expect(opt.label).toBe('SURMOUNT-1');
  });

  it('falls back to name when acronym is null', () => {
    const opt = toTrialOption(makeTrial({ acronym: null }));
    expect(opt.label).toBe('A Study of Tirzepatide (LY3298176) in Participants With Obesity');
  });

  it('falls back to name when acronym is whitespace', () => {
    const opt = toTrialOption(makeTrial({ acronym: '   ' }));
    expect(opt.label).toBe('A Study of Tirzepatide (LY3298176) in Participants With Obesity');
  });

  it('exposes company and asset names from the nested assets relation', () => {
    const opt = toTrialOption(makeTrial());
    expect(opt.companyName).toBe('Lilly');
    expect(opt.assetName).toBe('Tirzepatide');
  });

  it('returns empty strings when the assets relation is missing', () => {
    const opt = toTrialOption(makeTrial({ assets: null }));
    expect(opt.companyName).toBe('');
    expect(opt.assetName).toBe('');
  });

  it('returns empty string when the asset has no company', () => {
    const opt = toTrialOption(makeTrial({ assets: { id: 'a1', name: 'Tirzepatide', companies: null } }));
    expect(opt.companyName).toBe('');
    expect(opt.assetName).toBe('Tirzepatide');
  });

  it('passes through the NCT identifier verbatim', () => {
    expect(toTrialOption(makeTrial()).identifier).toBe('NCT04184622');
    expect(toTrialOption(makeTrial({ identifier: null })).identifier).toBe('');
  });

  it('preserves the id for use as p-select optionValue', () => {
    expect(toTrialOption(makeTrial({ id: 'abc' })).id).toBe('abc');
  });

  it('keeps the raw briefTitle on the option so it can be used as a search target', () => {
    expect(toTrialOption(makeTrial()).briefTitle).toBe(
      'A Study of Tirzepatide (LY3298176) in Participants With Obesity'
    );
  });
});
```

- [ ] **Step 2: Run the spec, confirm it fails**

Run: `cd src/client && npx vitest run src/app/core/utils/to-trial-option.spec.ts`
Expected: FAIL with "Cannot find module './to-trial-option'".

- [ ] **Step 3: Write the implementation**

```ts
// src/client/src/app/core/utils/to-trial-option.ts
import type { Trial } from '../models/trial.model';

export interface TrialOption {
  id: string;
  label: string;
  briefTitle: string;
  identifier: string;
  companyName: string;
  assetName: string;
}

export function toTrialOption(trial: Trial): TrialOption {
  const acronym = trial.acronym?.trim() ?? '';
  const name = trial.name ?? '';
  return {
    id: trial.id,
    label: acronym || name,
    briefTitle: name,
    identifier: trial.identifier ?? '',
    companyName: trial.assets?.companies?.name ?? '',
    assetName: trial.assets?.name ?? '',
  };
}
```

- [ ] **Step 4: Run the spec, confirm it passes**

Run: `cd src/client && npx vitest run src/app/core/utils/to-trial-option.spec.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/utils/to-trial-option.ts src/client/src/app/core/utils/to-trial-option.spec.ts
git commit -m "Add toTrialOption mapping shared by trial pickers"
```

---

## Task 3: Event-form trial picker uses TrialOption + two-line template

**Files:**
- Modify: `src/client/src/app/features/events/event-form.component.ts`

**Current state** (around lines 93-104, 378-384, 516-524): the `entityOptions` signal is typed as `{ id: string; name: string }[]` and the p-select uses `optionLabel="name"`. For trials specifically, the mapping is `this.trials().map((t) => ({ id: t.id, name: t.name }))`.

**Target state:** When the entity level is `trial`, set `entityOptions` to `TrialOption[]`. The same p-select renders a two-line template for trials (acronym top, `Company  ·  Asset  ·  NCT` bottom) while continuing to render single-line for companies and assets.

- [ ] **Step 1: Add the import and widen the entityOptions type**

Replace the `entityOptions` declaration (currently `readonly entityOptions = signal<{ id: string; name: string }[]>([]);`):

```ts
import { toTrialOption, type TrialOption } from '../../core/utils/to-trial-option';

// ...

type EntityOption =
  | { kind: 'company' | 'product'; id: string; label: string }
  | (TrialOption & { kind: 'trial' });

readonly entityOptions = signal<EntityOption[]>([]);
```

- [ ] **Step 2: Update every site that writes `entityOptions`**

There are three sites (`onEntityLevelChange`, `resetForm` is fine, `loadExisting`). For each, branch on level:

```ts
// in the level-changed handler around line 378:
if (level === 'company') {
  this.entityOptions.set(this.companies().map((c) => ({ kind: 'company' as const, id: c.id, label: c.name })));
} else if (level === 'product') {
  this.entityOptions.set(this.assets().map((p) => ({ kind: 'product' as const, id: p.id, label: p.name })));
} else if (level === 'trial') {
  this.entityOptions.set(this.trials().map((t) => ({ kind: 'trial' as const, ...toTrialOption(t) })));
} else {
  this.entityOptions.set([]);
}
```

Apply the same change to the `loadExisting` block (around line 516-524).

- [ ] **Step 3: Update the p-select template**

Replace the existing p-select block (lines 93-104):

```html
<p-select
  inputId="event-entity"
  [options]="entityOptions()"
  [ngModel]="entityId()"
  (ngModelChange)="entityId.set($event)"
  name="entityId"
  optionLabel="label"
  optionValue="id"
  placeholder="Select..."
  [filter]="true"
  filterBy="label,identifier,companyName,assetName,briefTitle"
  styleClass="w-full"
  appendTo="body"
>
  <ng-template let-opt pTemplate="item">
    @if (opt.kind === 'trial') {
      <div class="flex flex-col py-0.5">
        <span class="text-sm text-slate-900">{{ opt.label }}</span>
        <span class="text-xs text-slate-500 truncate">
          {{ opt.companyName }}
          @if (opt.companyName && opt.assetName) {
            <span class="mx-1">&middot;</span>
          }
          {{ opt.assetName }}
          @if ((opt.companyName || opt.assetName) && opt.identifier) {
            <span class="mx-1">&middot;</span>
          }
          <span class="font-mono">{{ opt.identifier }}</span>
        </span>
      </div>
    } @else {
      <span class="text-sm">{{ opt.label }}</span>
    }
  </ng-template>
  <ng-template let-opt pTemplate="selectedItem">
    <span class="text-sm">{{ opt.label }}</span>
  </ng-template>
</p-select>
```

Notes:
- `appendTo="body"` was missing on this select — added to match the date picker pattern and prevent dialog overflow clipping.
- `filterBy` lists all searchable fields so analysts can type a company name or NCT to find a trial.
- The `&middot;` separator avoids em dashes per project policy.
- The native control flow `@if`/`@else` is used inside the template, not `*ngIf`.

- [ ] **Step 4: Run lint and build**

Run: `cd src/client && ng lint --files src/app/features/events/event-form.component.ts`
Expected: 0 errors.

Run: `cd src/client && ng build --configuration=local`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/events/event-form.component.ts
git commit -m "Show acronym and company/asset/NCT in event-form trial picker"
```

---

## Task 4: Marker-form trial picker uses TrialOption + two-line template

**Files:**
- Modify: `src/client/src/app/features/manage/trials/marker-form.component.ts`

**Current state** (around line 220-234, lines 289 and 376-378): the p-multiselect binds directly to `trials()` (a `signal<Trial[]>`) and uses `optionLabel="name"`. The `selectedItemsLabel` already gives a compact chip count, so no visible degradation when this changes.

**Target state:** Derive a computed signal `trialOptions = computed(() => this.trials().map(toTrialOption))` and bind the p-multiselect to that. Add an item template identical in spirit to event-form's.

- [ ] **Step 1: Add the import and computed signal**

In the imports block:
```ts
import { computed, ... } from '@angular/core';
import { toTrialOption, type TrialOption } from '../../../core/utils/to-trial-option';
```

In the class body, near the existing `trials` signal (around line 289):
```ts
protected readonly trialOptions = computed<TrialOption[]>(() =>
  this.trials().map(toTrialOption),
);
```

(No change needed to `trials()` itself — it still holds the raw `Trial[]` used elsewhere in the file for `selectedTrials` lookup in `submitForm`.)

- [ ] **Step 2: Update the p-multiselect template**

Replace lines 220-234:

```html
<p-multiselect
  inputId="marker-trials"
  [options]="trialOptions()"
  [ngModel]="selectedTrialIds()"
  (ngModelChange)="selectedTrialIds.set($event ?? [])"
  name="selectedTrialIds"
  optionLabel="label"
  optionValue="id"
  placeholder="Select trials"
  [filter]="true"
  filterBy="label,identifier,companyName,assetName,briefTitle"
  styleClass="w-full"
  class="mt-1"
  aria-required="true"
  appendTo="body"
  [maxSelectedLabels]="0"
  [selectedItemsLabel]="'Trial (' + selectedTrialIds().length + ')'"
>
  <ng-template let-opt pTemplate="item">
    <div class="flex flex-col py-0.5">
      <span class="text-sm text-slate-900">{{ opt.label }}</span>
      <span class="text-xs text-slate-500 truncate">
        {{ opt.companyName }}
        @if (opt.companyName && opt.assetName) {
          <span class="mx-1">&middot;</span>
        }
        {{ opt.assetName }}
        @if ((opt.companyName || opt.assetName) && opt.identifier) {
          <span class="mx-1">&middot;</span>
        }
        <span class="font-mono">{{ opt.identifier }}</span>
      </span>
    </div>
  </ng-template>
</p-multiselect>
```

- [ ] **Step 3: Run lint and build**

Run: `cd src/client && ng lint --files src/app/features/manage/trials/marker-form.component.ts`
Expected: 0 errors.

Run: `cd src/client && ng build --configuration=local`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/marker-form.component.ts
git commit -m "Show acronym and company/asset/NCT in marker-form trial picker"
```

---

## Task 5: Manual verification, full project lint/build, push

- [ ] **Step 1: Full client lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors, build succeeds.

- [ ] **Step 2: Vitest sweep**

Run: `cd src/client && npx vitest run`
Expected: all specs pass (including the new `to-trial-option.spec.ts`).

- [ ] **Step 3: Launch the local dev server and exercise both surfaces**

Run: `cd src/client && npm run start:local` (or whatever the local-config command is) in the background; open the app.
  1. Dashboard: confirm the TRIAL column now shows `SURMOUNT-1`, `ATTAIN-1`, etc., for trials that have an acronym set.
  2. Bullseye view: confirm trial labels in the detail panel match.
  3. Open the event create dialog, switch entity to `Trial`, open the dropdown: confirm two-line layout with acronym + `Company  ·  Asset  ·  NCT`. Type a company name to confirm filterBy works.
  4. Open a trial detail page, open the marker editor: confirm the multi-select shows two-line trial entries.

Type checks verify code, not behavior. Confirm each surface visually.

- [ ] **Step 4: Push**

```bash
git push
```

(The user's auto-push policy applies once the change set is clean and tests pass.)

---

## Self-Review

**Spec coverage:**
- Trial acronyms on dashboard grid → Task 1 RPC change + existing client fallback.
- Trial acronyms on bullseye / landscape views → Task 1 covers all 6 RPCs.
- Event-form trial picker shows acronym + metadata → Task 3.
- Marker-form trial picker shows acronym + metadata → Task 4.
- Source-import review page → Not addressed: that surface has no trial picker, confirmed by grep. Documented in the File Structure section.

**Placeholder scan:**
- The migration body in Task 1 Step 1 contains comments saying "paste the full latest definition" rather than inline SQL. This is intentional — the recreated functions are large (100+ lines each) and copying them into the plan adds noise without adding signal; the engineer executing the task has the source migration paths to copy from. The non-copy parts (smoke test, migration header) are inline in full.

**Type consistency:**
- `TrialOption` shape is defined once in Task 2 and reused unchanged in Tasks 3 and 4.
- Both p-select and p-multiselect use `optionLabel="label"` and `optionValue="id"`, matching `TrialOption.label` and `TrialOption.id`.
- `filterBy` lists exactly the fields exposed by `TrialOption`: `label,identifier,companyName,assetName,briefTitle`.

**Spec gap reflection:**
- The smoke test only asserts the dashboard RPC explicitly. The five bullseye RPCs are listed as "repeat the same assertion" — when implementing, write each one out, no helpers; per the project's "Audit fields server-side only" precedent, smoke assertions stay verbose and explicit.
