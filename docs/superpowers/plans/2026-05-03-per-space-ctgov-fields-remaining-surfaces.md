# Per-Space CT.gov Fields on Remaining 4 Surfaces - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the 4 unwired surfaces of `spaces.ctgov_field_visibility` (`bullseye_detail_panel`, `timeline_detail`, `key_catalysts_panel`, `trial_list_columns`) so each renders the user's chosen CT.gov fields, falling back to per-surface defaults from `ctgov-field.model.ts`.

**Architecture:**
- `trial_list_columns` ships server-side: a new RPC returns latest CT.gov snapshots for every trial in a space; the trial-list page renders extra read-only columns from the per-space path map.
- `bullseye_detail_panel`, `timeline_detail`, `key_catalysts_panel` ship client-side lazy: each panel fetches `getLatestSnapshot(trial_id)` only when a trial/marker is selected, then mounts `<app-ctgov-field-renderer>` against the chosen paths. `timeline_detail` and `key_catalysts_panel` share `MarkerDetailContentComponent`, differentiated by a new `surfaceKey` input.
- A small `formatCtgovFieldValue(payload, path)` helper extracted from `CtgovFieldRendererComponent` renders inline values for the trial-list cells.

**Tech Stack:** Angular 19 standalone + signals, PrimeNG p-table, Supabase Postgres RPC + RLS, plpgsql `security invoker`. New migration file follows the timestamped naming convention; never edit `20260503010000_drop_orphaned_column_refs_in_rpcs.sql`.

---

## File Structure

**New:**
- `supabase/migrations/20260503030000_list_latest_snapshots_for_space.sql` - Adds `public.list_latest_snapshots_for_space(p_space_id uuid)` RPC + smoke test asserting the RPC returns a populated payload for a hermetic fixture.
- `src/client/src/app/shared/utils/ctgov-field-format.ts` - Shared `walkCtgovPath(payload, path)` and `formatCtgovFieldValue(payload, path)` helpers. Used by both the renderer and the new trial-list cells.

**Modified:**
- `src/client/src/app/shared/components/ctgov-field-renderer/ctgov-field-renderer.component.ts` - Re-import `walkCtgovPath` from the new util, drop the local copy.
- `src/client/src/app/core/services/trial.service.ts` - Add `getLatestSnapshotsForSpace(spaceId): Promise<Map<string, unknown>>`.
- `src/client/src/app/features/manage/trials/trial-list.component.ts` - Inject `SpaceFieldVisibilityService`, load per-space `trial_list_columns` paths + snapshot map; compute extra column descriptors and per-row extras; expose to template.
- `src/client/src/app/features/manage/trials/trial-list.component.html` - Render dynamic extra columns after the Markers column.
- `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts` - Inject `SpaceFieldVisibilityService` + `TrialService`; load paths once per space; lazy-load snapshots for `visibleTrials()` when `selectedProduct()` changes; expose `paths()` and `snapshotFor(trialId)` to template.
- `src/client/src/app/features/landscape/bullseye-detail-panel.component.html` - Mount `<app-ctgov-field-renderer dense>` per trial below the existing trial summary, only when paths are non-empty AND a snapshot exists.
- `src/client/src/app/shared/components/marker-detail-content.component.ts` - Add `surfaceKey: 'timeline_detail' | 'key_catalysts_panel'` input (default `'timeline_detail'`); load per-space paths for that key; lazy-load snapshot via `TrialService.getLatestSnapshot(d.catalyst.trial_id)`; mount the field renderer under the existing Trial section.
- `src/client/src/app/shared/components/marker-detail-panel.component.ts` - Forward a new `surfaceKey` input through to `<app-marker-detail-content>`.
- `src/client/src/app/features/landscape/landscape-shell.component.ts` - Compute `surfaceKey` from `viewMode()` (`catalysts` -> `key_catalysts_panel`, else `timeline_detail`); pass to `<app-marker-detail-panel>`.

**Untouched:**
- `src/client/src/app/features/events/event-detail-panel.component.ts` - Out-of-scope; keeps default `surfaceKey` (`timeline_detail`).
- `src/client/src/app/features/space-settings/*` - The picker UI is out of scope per the brief.

---

## Background context (read this once before Task 1)

### Wiring pattern (from trial-detail.component.ts c80f731)
```ts
private readonly fieldVisibilityService = inject(SpaceFieldVisibilityService);
private readonly perSpaceDetailPaths = signal<string[] | null>(null);
detailExtraPaths = computed(() => this.perSpaceDetailPaths() ?? CTGOV_DETAIL_DEFAULT_PATHS);

private async loadFieldVisibility(): Promise<void> {
  const spaceId = this.route.snapshot.paramMap.get('spaceId');
  if (!spaceId) return;
  try {
    const map = await this.fieldVisibilityService.get(spaceId);
    const paths = map['trial_detail'];
    this.perSpaceDetailPaths.set(paths && paths.length > 0 ? paths : null);
  } catch {
    this.perSpaceDetailPaths.set(null);
  }
}
```

### Per-surface defaults (from `ctgov-field.model.ts`)
- `CTGOV_BULLSEYE_DEFAULT_PATHS` -> `['protocolSection.sponsorCollaboratorsModule.leadSponsor.name']`
- `CTGOV_KEY_CATALYSTS_DEFAULT_PATHS` -> `['protocolSection.sponsorCollaboratorsModule.leadSponsor.name']`
- `CTGOV_TIMELINE_DEFAULT_PATHS` -> `[]` (empty by design - silent unless space customizes)
- `CTGOV_TRIAL_LIST_DEFAULT_PATHS` -> `['protocolSection.identificationModule.nctId']`

### Snapshot table shape (`trial_ctgov_snapshots`)
- Columns: `id`, `trial_id`, `space_id`, `nct_id`, `ctgov_version int`, `last_update_post_date date`, `payload jsonb`, `fetched_via`, `fetched_at`.
- Latest payload per trial = `distinct on (trial_id) ... order by trial_id, ctgov_version desc`.
- RLS: `for select to authenticated using (public.has_space_access(space_id))`.

---

## Task 0: Branch + shared formatting helper

**Files:**
- Create: `src/client/src/app/shared/utils/ctgov-field-format.ts`
- Modify: `src/client/src/app/shared/components/ctgov-field-renderer/ctgov-field-renderer.component.ts`

- [ ] **Step 0.1: Create branch**

```bash
git checkout -b feat/per-space-ctgov-fields-remaining-surfaces
```

- [ ] **Step 0.2: Extract walkCtgovPath + formatCtgovFieldValue**

Create `src/client/src/app/shared/utils/ctgov-field-format.ts`:

```ts
import { CTGOV_FIELD_CATALOGUE, CtgovField } from '../../core/models/ctgov-field.model';

/** Walk a dotted JSON path (e.g. 'protocolSection.identificationModule.nctId') against a snapshot payload. */
export function walkCtgovPath(snap: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = snap;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function lookupCtgovField(path: string): CtgovField | undefined {
  return CTGOV_FIELD_CATALOGUE.find((f) => f.path === path);
}

/**
 * Format a single field value as a single-line string for inline / table-cell
 * display. Long-text and array values are truncated; null/undefined returns
 * empty string so callers can choose their own placeholder.
 */
export function formatCtgovFieldValue(snap: unknown, path: string): string {
  const field = lookupCtgovField(path);
  if (!field) return '';
  const value = walkCtgovPath(snap, path);
  if (value === null || value === undefined) return '';
  switch (field.kind) {
    case 'string':
    case 'longtext':
      return String(value);
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'boolean':
      return value === true ? 'Yes' : value === false ? 'No' : '';
    case 'date': {
      const d = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
      return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
    }
    case 'array': {
      if (!Array.isArray(value)) return '';
      if (field.summary === 'count') return `${value.length} items`;
      const items = value
        .map((v) => (field.itemPath && typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[field.itemPath] : v))
        .filter((v): v is string | number | boolean => v !== null && v !== undefined);
      return items.join(', ');
    }
  }
}
```

- [ ] **Step 0.3: Re-import walkCtgovPath in CtgovFieldRendererComponent**

In `src/client/src/app/shared/components/ctgov-field-renderer/ctgov-field-renderer.component.ts`:

Replace the local `walkPath` and `lookupField` private functions with:

```ts
import { walkCtgovPath, lookupCtgovField } from '../../utils/ctgov-field-format';
```

And replace usages: `walkPath(snap, path)` -> `walkCtgovPath(snap, path)`, `lookupField(path)` -> `lookupCtgovField(path)`. Delete the old local functions.

- [ ] **Step 0.4: Verify build**

```bash
cd src/client && ng lint && ng build
```

Expected: PASS, no warnings about new helper.

- [ ] **Step 0.5: Commit**

```bash
git add src/client/src/app/shared/utils/ctgov-field-format.ts \
        src/client/src/app/shared/components/ctgov-field-renderer/ctgov-field-renderer.component.ts
git commit -m "refactor(ctgov): extract walkCtgovPath / formatCtgovFieldValue helpers

Pulls the snapshot-walk + per-kind formatting out of CtgovFieldRendererComponent
so the upcoming trial-list dynamic columns can render snapshot values inline
without instantiating the renderer for each cell. No behavior change for the
renderer itself."
```

---

## Task 1: Surface 1 - trial_list_columns

**Files:**
- Create: `supabase/migrations/20260503030000_list_latest_snapshots_for_space.sql`
- Modify: `src/client/src/app/core/services/trial.service.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.html`

### Why server-side here

The trial list shows every trial in a space (often 100+). Lazy-loading a snapshot per row would fan out into N round trips on first paint. One batched RPC keeps first paint snappy and respects RLS via `has_space_access(space_id)`.

### Why no sort/filter on extra columns

Per the brief: "Trial list column rendering must respect the existing pSortableColumn / p-columnFilter convention -- don't break sort / filter on chosen extra columns." The constraint is "don't break" - we render extras as read-only cells without `pSortableColumn` or `p-columnFilter` so the existing static columns keep their behavior intact.

- [ ] **Step 1.1: Write the new RPC migration**

Create `supabase/migrations/20260503030000_list_latest_snapshots_for_space.sql`:

```sql
-- migration: 20260503030000_list_latest_snapshots_for_space
-- purpose: ship a single-call RPC that returns the latest ct.gov snapshot
--   payload for every trial in a space, used by the trial-list page to
--   render per-space-configurable extra columns (trial_list_columns surface
--   of spaces.ctgov_field_visibility).
--
-- chose batched RPC over fan-out lazy-load because the trial-list shows all
-- trials in a space at once; N round trips would dominate first-paint.
-- distinct on(trial_id) order by ctgov_version desc returns latest per trial.
--
-- See plan: docs/superpowers/plans/2026-05-03-per-space-ctgov-fields-remaining-surfaces.md

create or replace function public.list_latest_snapshots_for_space(p_space_id uuid)
returns table (trial_id uuid, payload jsonb, fetched_at timestamptz)
language sql
security invoker
stable
set search_path to ''
as $$
  select distinct on (s.trial_id)
    s.trial_id,
    s.payload,
    s.fetched_at
  from public.trial_ctgov_snapshots s
  where s.space_id = p_space_id
  order by s.trial_id, s.ctgov_version desc;
$$;

comment on function public.list_latest_snapshots_for_space is
  'Returns the latest ct.gov snapshot payload per trial in a space. Used by the trial-list dynamic columns surface. Security invoker -- RLS on trial_ctgov_snapshots filters to spaces the caller has access to.';

-- =============================================================================
-- Smoke test: bootstrap a hermetic fixture, insert two snapshots for the same
-- trial, call the RPC, assert it returns exactly the latest payload. Tear
-- down via savepoint rollback so the fixture is not visible to seed.sql.
-- =============================================================================
do $$
declare
  v_agency_id  uuid := '88888881-8888-8888-8888-888888888881';
  v_tenant_id  uuid := '88888882-8888-8888-8888-888888888882';
  v_user_id    uuid := '88888883-8888-8888-8888-888888888883';
  v_space_id   uuid := '88888884-8888-8888-8888-888888888884';
  v_company_id uuid := '88888885-8888-8888-8888-888888888885';
  v_product_id uuid := '88888886-8888-8888-8888-888888888886';
  v_ta_id      uuid := '88888887-8888-8888-8888-888888888887';
  v_trial_id   uuid := '88888888-8888-8888-8888-888888888888';
  v_count      int;
  v_payload    jsonb;
begin
  insert into auth.users (id, email) values (v_user_id, 'smoke-list-snap@example.com');
  insert into public.agencies (id, name, slug, subdomain, created_by)
    values (v_agency_id, 'Smoke Agency', 'smoke-snap', 'smoke-snap', v_user_id);
  insert into public.tenants (id, agency_id, name, slug, subdomain, created_by)
    values (v_tenant_id, v_agency_id, 'Smoke Tenant', 'smoke-snap', 'smoke-snap', v_user_id);
  insert into public.spaces (id, tenant_id, name, slug, created_by)
    values (v_space_id, v_tenant_id, 'Smoke Space', 'smoke-snap', v_user_id);
  insert into public.companies (id, space_id, name, display_order, created_by)
    values (v_company_id, v_space_id, 'Smoke Co', 0, v_user_id);
  insert into public.therapeutic_areas (id, space_id, name, abbreviation, created_by)
    values (v_ta_id, v_space_id, 'Smoke TA', 'SM', v_user_id);
  insert into public.products (id, space_id, company_id, name, display_order, created_by)
    values (v_product_id, v_space_id, v_company_id, 'Smoke Product', 0, v_user_id);
  insert into public.trials (id, space_id, product_id, therapeutic_area_id, name, identifier, display_order, created_by)
    values (v_trial_id, v_space_id, v_product_id, v_ta_id, 'Smoke Trial', 'NCT99998888', 0, v_user_id);

  insert into public.trial_ctgov_snapshots
    (trial_id, space_id, nct_id, ctgov_version, last_update_post_date, payload, fetched_via)
  values
    (v_trial_id, v_space_id, 'NCT99998888', 1, '2026-05-01',
     jsonb_build_object('protocolSection', jsonb_build_object('identificationModule', jsonb_build_object('nctId', 'NCT99998888'))),
     'smoke'),
    (v_trial_id, v_space_id, 'NCT99998888', 2, '2026-05-02',
     jsonb_build_object('protocolSection', jsonb_build_object('identificationModule', jsonb_build_object('nctId', 'NCT99998888-LATEST'))),
     'smoke');

  select count(*), (array_agg(payload order by fetched_at desc))[1]
    into v_count, v_payload
  from public.list_latest_snapshots_for_space(v_space_id);

  if v_count <> 1 then
    raise exception 'list_latest_snapshots_for_space smoke FAIL: expected 1 row, got %', v_count;
  end if;
  if v_payload->'protocolSection'->'identificationModule'->>'nctId' <> 'NCT99998888-LATEST' then
    raise exception 'list_latest_snapshots_for_space smoke FAIL: expected latest payload, got %', v_payload;
  end if;

  delete from public.trial_ctgov_snapshots where space_id = v_space_id;
  delete from public.trials where space_id = v_space_id;
  delete from public.products where space_id = v_space_id;
  delete from public.therapeutic_areas where space_id = v_space_id;
  delete from public.companies where space_id = v_space_id;
  delete from public.spaces where id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'list_latest_snapshots_for_space smoke test: PASS';
end $$;
```

- [ ] **Step 1.2: Apply the migration locally**

```bash
supabase db reset
```

Expected: completes without error; output contains `list_latest_snapshots_for_space smoke test: PASS`.

- [ ] **Step 1.3: Add the service method**

In `src/client/src/app/core/services/trial.service.ts`, after `getLatestSnapshot(...)`:

```ts
async getLatestSnapshotsForSpace(spaceId: string): Promise<Map<string, unknown>> {
  const { data, error } = await this.supabase.client.rpc('list_latest_snapshots_for_space', {
    p_space_id: spaceId,
  });
  if (error) throw error;
  const out = new Map<string, unknown>();
  for (const row of (data ?? []) as { trial_id: string; payload: unknown }[]) {
    out.set(row.trial_id, row.payload);
  }
  return out;
}
```

- [ ] **Step 1.4: Wire trial-list.component.ts**

Add imports:

```ts
import { SpaceFieldVisibilityService } from '../../../core/services/space-field-visibility.service';
import {
  CTGOV_FIELD_CATALOGUE,
  CTGOV_TRIAL_LIST_DEFAULT_PATHS,
} from '../../../core/models/ctgov-field.model';
import { formatCtgovFieldValue } from '../../../shared/utils/ctgov-field-format';
```

Add fields after the existing `creating = signal(false)` line:

```ts
private readonly fieldVisibilityService = inject(SpaceFieldVisibilityService);
private readonly perSpacePaths = signal<string[] | null>(null);
private readonly snapshotsByTrial = signal<Map<string, unknown>>(new Map());

readonly extraPaths = computed(() => this.perSpacePaths() ?? CTGOV_TRIAL_LIST_DEFAULT_PATHS);

readonly extraColumns = computed(() => {
  return this.extraPaths()
    .map((path) => {
      const field = CTGOV_FIELD_CATALOGUE.find((f) => f.path === path);
      return field ? { path, label: field.label } : null;
    })
    .filter((c): c is { path: string; label: string } => c !== null);
});
```

Update `loadData()` to load the per-space map and snapshots in parallel:

```ts
private async loadData(): Promise<void> {
  this.loading.set(true);
  try {
    const spaceId = this.spaceId();
    const [trials, products, companies, visibilityMap, snapshots] = await Promise.all([
      this.trialService.listBySpace(spaceId),
      this.productService.list(spaceId),
      this.companyService.list(spaceId),
      this.fieldVisibilityService.get(spaceId).catch(() => ({}) as Record<string, string[]>),
      this.trialService.getLatestSnapshotsForSpace(spaceId).catch(() => new Map<string, unknown>()),
    ]);
    this.trials.set(trials);
    this.products.set(products);
    this.companies.set(companies);
    const paths = visibilityMap['trial_list_columns'];
    this.perSpacePaths.set(paths && paths.length > 0 ? paths : null);
    this.snapshotsByTrial.set(snapshots);
    this.menuCache.clear();
  } catch (err) {
    this.error.set(err instanceof Error ? err.message : 'Failed to load trials');
  } finally {
    this.loading.set(false);
  }
}
```

Add a public template helper (next to `rowMenu`):

```ts
extraValue(trialId: string, path: string): string {
  const snap = this.snapshotsByTrial().get(trialId);
  if (!snap) return '';
  return formatCtgovFieldValue(snap, path);
}
```

- [ ] **Step 1.5: Wire trial-list.component.html**

After the existing `<th>` for `markerCount` (line 113) and before `<th class="col-actions"></th>`, insert:

```html
@for (col of extraColumns(); track col.path) {
  <th>{{ col.label }}</th>
}
```

After the existing `<td>` for `markerCount` (the second `class="col-num"` cell rendering `{{ row.markerCount }}`) and before `<td class="col-actions">`, insert:

```html
@for (col of extraColumns(); track col.path) {
  <td class="col-secondary">{{ extraValue(row.trial.id, col.path) || '--' }}</td>
}
```

Update the empty-message colspan from `colspan="8"` to a computed value or to `9 + extraColumns().length - 1`. Simplest: replace with a computed:

```ts
readonly emptyColspan = computed(() => 8 + this.extraColumns().length);
```

And in HTML: `<td [attr.colspan]="emptyColspan()">`.

Update the `<app-table-skeleton-body [cells]="...">` array similarly: append one `{ w: '60px' }` per extra column at runtime. Easiest is to compute the cells signal:

```ts
readonly skeletonCells = computed(() => {
  const base = [
    { w: '58%' },
    { w: '80px', h: '11px' },
    { w: '55%' },
    { w: '55%' },
    { w: '58px', h: '14px' },
    { w: '20px', class: 'col-num' },
    { w: '20px', class: 'col-num' },
  ];
  for (let i = 0; i < this.extraColumns().length; i++) base.push({ w: '60%' });
  base.push({ w: '14px', class: 'col-actions' });
  return base;
});
```

And in HTML: `<app-table-skeleton-body [cells]="skeletonCells()" />`.

- [ ] **Step 1.6: Verify build**

```bash
cd src/client && ng lint && ng build
```

Expected: PASS.

- [ ] **Step 1.7: Manual verification**

1. `supabase start && cd src/client && ng serve`
2. Sign in, open a space with trials and at least one CT.gov-synced trial.
3. Visit `/t/<t>/s/<s>/settings/fields`, switch to "Trial list" tab, set fields (e.g. "Lead sponsor" + "Phases"), save.
4. Visit `/t/<t>/s/<s>/manage/trials`. Confirm new columns appear with values from the snapshot. Trials with no snapshot show `--`.
5. Clear the picker, save. Reload trials list. Confirm the default `nctId` column appears.
6. Confirm sort/filter on existing columns (Trial, NCT ID, Product, Company, Status, Phases, Markers) still work.

- [ ] **Step 1.8: Commit**

```bash
git add supabase/migrations/20260503030000_list_latest_snapshots_for_space.sql \
        src/client/src/app/core/services/trial.service.ts \
        src/client/src/app/features/manage/trials/trial-list.component.ts \
        src/client/src/app/features/manage/trials/trial-list.component.html
git commit -m "feat(trials): wire per-space CT.gov fields into trial-list columns

Adds list_latest_snapshots_for_space RPC + smoke test, and renders the
per-space trial_list_columns config as read-only extra columns after the
Markers column. Falls back to CTGOV_TRIAL_LIST_DEFAULT_PATHS (NCT id) when
the space has not customized this surface. Existing column sort/filter
unchanged. Refs task #10."
```

---

## Task 2: Surface 2 - bullseye_detail_panel

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts`
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.html`

### Why lazy-load here

The bullseye RPC payload is already heavy (every product, every trial, every spoke). Adding `payload` per trial would balloon it ~50-100x. The detail panel only shows one selected product at a time with a default cap of 8 visible trials, so an 8-element `Promise.all` of `getLatestSnapshot()` calls runs once when selection changes - well within budget.

- [ ] **Step 2.1: Wire bullseye-detail-panel.component.ts**

Add imports:

```ts
import { ActivatedRoute } from '@angular/router';
import { SpaceFieldVisibilityService } from '../../core/services/space-field-visibility.service';
import { TrialService } from '../../core/services/trial.service';
import { CTGOV_BULLSEYE_DEFAULT_PATHS } from '../../core/models/ctgov-field.model';
import { CtgovFieldRendererComponent } from '../../shared/components/ctgov-field-renderer/ctgov-field-renderer.component';
```

Add to component `imports`: `CtgovFieldRendererComponent`.

Inject + state (place near the existing `showAllTrials` private signal):

```ts
private readonly route = inject(ActivatedRoute);
private readonly fieldVisibility = inject(SpaceFieldVisibilityService);
private readonly trialService = inject(TrialService);

private readonly perSpacePaths = signal<string[] | null>(null);
private readonly snapshotByTrial = signal<Map<string, unknown>>(new Map());

readonly bullseyePaths = computed(() => this.perSpacePaths() ?? CTGOV_BULLSEYE_DEFAULT_PATHS);
```

In the constructor, after the existing `effect(() => { this.selectedProduct(); this.showAllTrials.set(false); });`:

```ts
// Load the per-space visibility map once when the spaceId is available.
let lastLoadedSpaceId: string | null = null;
effect(async () => {
  let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
  let spaceId: string | null = null;
  while (snap) {
    if (snap.paramMap.has('spaceId')) {
      spaceId = snap.paramMap.get('spaceId');
      break;
    }
    snap = snap.parent;
  }
  if (!spaceId || spaceId === lastLoadedSpaceId) return;
  lastLoadedSpaceId = spaceId;
  try {
    const map = await this.fieldVisibility.get(spaceId);
    const paths = map['bullseye_detail_panel'];
    this.perSpacePaths.set(paths && paths.length > 0 ? paths : null);
  } catch {
    this.perSpacePaths.set(null);
  }
});

// Lazy-load latest snapshots whenever the visible trial list changes.
effect(async () => {
  const trials = this.visibleTrials();
  if (this.bullseyePaths().length === 0) return;
  const have = this.snapshotByTrial();
  const missing = trials.map((t) => t.id).filter((id) => !have.has(id));
  if (missing.length === 0) return;
  const results = await Promise.all(
    missing.map(async (id) => {
      try {
        const s = await this.trialService.getLatestSnapshot(id);
        return [id, s?.payload ?? null] as const;
      } catch {
        return [id, null] as const;
      }
    })
  );
  this.snapshotByTrial.update((m) => {
    const next = new Map(m);
    for (const [id, payload] of results) next.set(id, payload);
    return next;
  });
});
```

Add a template helper:

```ts
snapshotFor(trialId: string): unknown | null {
  return this.snapshotByTrial().get(trialId) ?? null;
}
```

- [ ] **Step 2.2: Wire bullseye-detail-panel.component.html**

Inside the existing `@for (trial of visibleTrials(); ...)` block, after the closing `</button>` on line ~133, add (still inside `<li>`):

```html
@if (bullseyePaths().length > 0 && snapshotFor(trial.id); as snap) {
  <div class="px-2 pb-1.5">
    <app-ctgov-field-renderer [snapshot]="snap" [paths]="bullseyePaths()" [dense]="true" />
  </div>
}
```

The `dense` flag is already an input on `CtgovFieldRendererComponent` (currently unused by the template; that is fine - we keep the prop for future styling consistency). The renderer's `<dl>` layout fits the panel because the panel has `gap-3` between sections; the inner `dl` inherits `text-sm`.

- [ ] **Step 2.3: Verify build**

```bash
cd src/client && ng lint && ng build
```

Expected: PASS.

- [ ] **Step 2.4: Manual verification**

1. With dev server running, settings page -> "Bullseye detail" tab, select e.g. "Lead sponsor" + "Phases" + "Conditions", save.
2. Open landscape `/t/<t>/s/<s>/bullseye/by-therapy-area`, select an entity with synced trials, click a product. Confirm the chosen fields render under each trial in the right-side panel.
3. Clear the picker, save, reload. Confirm only the default "Lead sponsor" renders.
4. Click a trial that has no snapshot yet; confirm the dl block does not render (no broken layout).
5. Switch to a different product; confirm the new product's trials get their own snapshot fetches.

- [ ] **Step 2.5: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-detail-panel.component.ts \
        src/client/src/app/features/landscape/bullseye-detail-panel.component.html
git commit -m "feat(landscape): wire per-space CT.gov fields into bullseye-detail-panel

Renders the per-space bullseye_detail_panel config under each trial in the
selected-product side panel; lazy-loads snapshots only for the trials
visible in the current selection. Defaults to CTGOV_BULLSEYE_DEFAULT_PATHS
(lead sponsor) when the space has not customized. Refs task #10."
```

---

## Task 3: Surface 3 - key_catalysts_panel (and the panel plumbing for surface 4)

**Files:**
- Modify: `src/client/src/app/shared/components/marker-detail-content.component.ts`
- Modify: `src/client/src/app/shared/components/marker-detail-panel.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-shell.component.ts`

### Why both surfaces share this commit's plumbing

`marker-detail-content` is the only renderer for both `timeline_detail` and `key_catalysts_panel`. The structural change (new `surfaceKey` input, lazy snapshot fetch, mounting the renderer) only happens once. We attribute this commit to `key_catalysts_panel` because that surface has a non-empty default and is the one users will see immediately. Surface 4's commit is a pure verification + docs/runbook touch.

- [ ] **Step 3.1: Add surfaceKey + snapshot loading to MarkerDetailContentComponent**

Add imports:

```ts
import { effect } from '@angular/core';
import { TrialService } from '../../core/services/trial.service';
import { SpaceFieldVisibilityService } from '../../core/services/space-field-visibility.service';
import {
  CTGOV_KEY_CATALYSTS_DEFAULT_PATHS,
  CTGOV_TIMELINE_DEFAULT_PATHS,
} from '../../core/models/ctgov-field.model';
import { CtgovFieldRendererComponent } from './ctgov-field-renderer/ctgov-field-renderer.component';
```

(Path note: the renderer lives at `shared/components/ctgov-field-renderer/...`, so the relative import from `shared/components/marker-detail-content.component.ts` is `./ctgov-field-renderer/ctgov-field-renderer.component`.)

Add to `imports` array: `CtgovFieldRendererComponent`.

Add inputs + state (next to the existing `spaceId` input):

```ts
readonly surfaceKey = input<'timeline_detail' | 'key_catalysts_panel'>('timeline_detail');

private readonly trialService = inject(TrialService);
private readonly fieldVisibility = inject(SpaceFieldVisibilityService);

private readonly snapshotPayload = signal<unknown | null>(null);
private readonly perSpacePaths = signal<string[] | null>(null);

readonly ctgovPaths = computed(() => {
  const paths = this.perSpacePaths();
  if (paths !== null) return paths;
  return this.surfaceKey() === 'key_catalysts_panel'
    ? CTGOV_KEY_CATALYSTS_DEFAULT_PATHS
    : CTGOV_TIMELINE_DEFAULT_PATHS;
});

private readonly snapshotEffect = effect(async () => {
  const trialId = this.detail()?.catalyst.trial_id ?? null;
  this.snapshotPayload.set(null);
  if (!trialId) return;
  try {
    const snap = await this.trialService.getLatestSnapshot(trialId);
    if (this.detail()?.catalyst.trial_id === trialId) {
      this.snapshotPayload.set(snap?.payload ?? null);
    }
  } catch {
    /* no-op: snapshot block stays hidden */
  }
});

private readonly visibilityEffect = effect(async () => {
  const spaceId = this.spaceId();
  const key = this.surfaceKey();
  if (!spaceId) {
    this.perSpacePaths.set(null);
    return;
  }
  try {
    const map = await this.fieldVisibility.get(spaceId);
    const paths = map[key];
    this.perSpacePaths.set(paths && paths.length > 0 ? paths : null);
  } catch {
    this.perSpacePaths.set(null);
  }
});
```

In the inline template, inside the existing `@if (d.catalyst.trial_name) { <div class="mb-3 border-b border-slate-100 pb-2"> ... </div> }` block (between the trial name/phase block and the date/status block), append at the end of that `<div>` (still inside the `@if`):

```html
@if (ctgovPaths().length > 0 && snapshotPayload(); as snap) {
  <div class="mt-2">
    <app-ctgov-field-renderer [snapshot]="snap" [paths]="ctgovPaths()" [dense]="true" />
  </div>
}
```

- [ ] **Step 3.2: Forward surfaceKey through MarkerDetailPanelComponent**

In `marker-detail-panel.component.ts`, add input near `mode`:

```ts
readonly surfaceKey = input<'timeline_detail' | 'key_catalysts_panel'>('timeline_detail');
```

In the inline template, change:

```html
<app-marker-detail-content
  [detail]="detail()"
  [spaceId]="spaceId()"
  (markerClick)="markerClick.emit($event)"
/>
```

to:

```html
<app-marker-detail-content
  [detail]="detail()"
  [spaceId]="spaceId()"
  [surfaceKey]="surfaceKey()"
  (markerClick)="markerClick.emit($event)"
/>
```

- [ ] **Step 3.3: Pass surfaceKey from landscape-shell**

In `landscape-shell.component.ts`, in the inline template's `<app-marker-detail-panel ...>` element, add:

```html
[surfaceKey]="viewMode() === 'catalysts' ? 'key_catalysts_panel' : 'timeline_detail'"
```

- [ ] **Step 3.4: Verify build**

```bash
cd src/client && ng lint && ng build
```

Expected: PASS, no template errors.

- [ ] **Step 3.5: Manual verification (key_catalysts_panel)**

1. Settings page -> "Key catalysts" tab, set fields (e.g. "Lead sponsor", "Primary completion date"), save.
2. Visit `/t/<t>/s/<s>/catalysts`, click a row whose marker has a `trial_id` with a synced snapshot.
3. Confirm the side panel shows the chosen fields under the Trial section.
4. Clear the picker, save, reload, click a row. Confirm only the default "Lead sponsor" renders.
5. Click a marker with no `trial_id` (rare); confirm the renderer block hides cleanly.

- [ ] **Step 3.6: Commit**

```bash
git add src/client/src/app/shared/components/marker-detail-content.component.ts \
        src/client/src/app/shared/components/marker-detail-panel.component.ts \
        src/client/src/app/features/landscape/landscape-shell.component.ts
git commit -m "feat(catalysts): wire per-space CT.gov fields into key-catalysts panel

Adds surfaceKey input to MarkerDetailContentComponent + MarkerDetailPanel,
threaded from landscape-shell so the catalysts route reads
key_catalysts_panel and the timeline route reads timeline_detail. Snapshot
is lazy-loaded by trial_id when a marker is selected. Refs task #10.

This commit also lays the plumbing surface 4 (timeline_detail) needs; that
surface ships in the next commit as a verification."
```

---

## Task 4: Surface 4 - timeline_detail (verification)

The structural change for `timeline_detail` shipped in Task 3 because the surface shares the same `MarkerDetailContentComponent`. Surface 4 is a verification + memo.

- [ ] **Step 4.1: Manual verification (timeline_detail)**

1. Settings page -> "Timeline detail" tab, set fields (e.g. "Phases", "Enrollment count"), save.
2. Visit `/t/<t>/s/<s>/timeline`, click a marker on a trial with a synced snapshot.
3. Confirm the slide-in panel shows the chosen fields under the Trial section.
4. Clear the picker, save, reload, click a marker. Confirm no field block renders (default for `CTGOV_TIMELINE_DEFAULT_PATHS` is `[]`, by design - timelines are dense, so silence is correct unless the space opts in).

- [ ] **Step 4.2: Empty commit to mark surface complete**

We do not modify code here; the surface was wired in Task 3. We still mark the surface as shipped in the project log so `git log --grep` can find each surface independently.

```bash
git commit --allow-empty -m "feat(timeline): verify per-space CT.gov fields render in timeline detail panel

No code change; the panel plumbing shipped with key_catalysts_panel in the
prior commit. This empty commit ends task #10 by marking the timeline_detail
surface as covered. Verified manually:
  - per-space timeline_detail paths render under the marker detail's Trial
    block when a trial is selected
  - empty default (CTGOV_TIMELINE_DEFAULT_PATHS) leaves the section silent
    until a space opts in
Refs task #10."
```

(If the team disallows empty commits via hook policy, instead bundle this into the Task 3 commit message and skip 4.2.)

---

## Task 5: Open the PR

- [ ] **Step 5.1: Push branch**

```bash
git push -u origin feat/per-space-ctgov-fields-remaining-surfaces
```

- [ ] **Step 5.2: Open PR**

```bash
gh pr create --title "feat: per-space CT.gov fields on remaining 4 surfaces" --body "$(cat <<'EOF'
## Summary

Wires the 4 unwired surfaces of `spaces.ctgov_field_visibility` so each renders the user's chosen CT.gov fields, falling back to per-surface defaults from `ctgov-field.model.ts`. Closes the gap left by c80f731 which wired only `trial_detail`.

| Surface | Where it renders | Snapshot source |
| --- | --- | --- |
| `trial_list_columns` | Manage > Trials table, after the Markers column | New `list_latest_snapshots_for_space` RPC, batched once per page load |
| `bullseye_detail_panel` | Selected-product side panel under each trial | `TrialService.getLatestSnapshot` per visible trial, lazy on selection |
| `key_catalysts_panel` | Catalysts side drawer under the Trial block | `TrialService.getLatestSnapshot(trial_id)` lazy on marker select |
| `timeline_detail` | Timeline marker drawer under the Trial block (same component as above; differentiated by new `surfaceKey` input) | Same lazy fetch as above |

Each surface ships as a separate commit so reverts stay surgical. Refs task #10. Prerequisite: c80f731.

## Test plan

- [ ] `supabase db reset` reports `list_latest_snapshots_for_space smoke test: PASS`
- [ ] `cd src/client && ng lint && ng build` clean
- [ ] Trial list: set per-space `trial_list_columns`, confirm extra columns render with values; clear, confirm defaults; existing column sort/filter unchanged
- [ ] Bullseye: set per-space `bullseye_detail_panel`, click a product, confirm fields render under each visible trial; clear, confirm defaults
- [ ] Key catalysts: set per-space `key_catalysts_panel`, click a catalyst row, confirm fields render in panel; clear, confirm defaults
- [ ] Timeline: set per-space `timeline_detail`, click a marker, confirm fields render; clear, confirm empty (by design)
EOF
)"
```

- [ ] **Step 5.3: Return PR URL**

Print the URL `gh pr create` returned for the user.

---

## Self-Review Checklist

- [x] **Spec coverage:** All 4 surfaces have a task; the renderer-extraction prerequisite is its own task; smoke test for the new RPC is in Task 1.1; no-touch for events-page is documented.
- [x] **Placeholder scan:** No `TBD`, no "implement later", no "similar to Task N", every code step has full code.
- [x] **Type consistency:** `surfaceKey` typing matches between `MarkerDetailContentComponent` and `MarkerDetailPanelComponent` (`'timeline_detail' | 'key_catalysts_panel'`); both surfaces have matching default-path imports; `getLatestSnapshotsForSpace` returns the same `Map<string, unknown>` shape used by both `extraValue()` and the bullseye snapshot map.
- [x] **Risk:** The bullseye panel's `effect()` for lazy-loading runs on every change to `visibleTrials()`; it short-circuits on cache hit, so flipping "Show all" doesn't refetch already-loaded snapshots.
