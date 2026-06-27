# Multi-level intelligence on the landscape views — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface company- and asset-anchored intelligence on the Timeline (per-level cell marks + toggled headlines), and surface company-anchored intelligence on the Heatmap and Bullseye when grouped by company.

**Architecture:** Three landscape RPCs gain new intelligence fields (lateral joins / computed flags) sourced from `primary_intelligence_anchors`; the Angular client renders a `<app-pi-mark>` on the visual element that represents each entity. No new interaction. Intelligence is strictly per-level (company cell = company-anchored only; asset = asset-anchored only), never rolled down.

**Tech Stack:** Postgres (Supabase migrations, plpgsql), Angular 19 (signals, standalone, OnPush), Vitest, Tailwind v4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-27-multilevel-intelligence-landscape-design.md`.
- Anchor `entity_type` per level (CHECK constraint forbids `'asset'`): trial = `'trial'`, **asset = `'product'`**, company = `'company'`. A join with the wrong value returns zero rows silently.
- Lead-headline selection mirrors the existing trial join exactly: `order by a_pi.is_lead desc, pi.published_at desc nulls last limit 1`, take `pi.headline`. Visibility gate: `pi.state = 'published'` and `a_pi.space_id = p_space_id`.
- No counts at any level. Presence = `<app-pi-mark>`. Headline only when the existing "Intelligence headlines" toggle (`showIntelligenceHeadlines()`) is on.
- SQL functions must be redefined from the **newest committed migration that defines them on this branch base** (NOT a live `pg_get_functiondef` dump — the shared local DB is polluted by parallel sessions' psql-applied funcs, and the dev DB is behind this base). Authoritative base files: `get_dashboard_data` → `20260627180000_fix_get_dashboard_data_unspecified_clobber.sql`; `get_positioning_data` → `20260627130600_intelligence_feed_and_landscape_multi.sql`; `get_bullseye_assets` → `20260627130900_fix_asset_entity_type_anchors.sql`. Redefining from an older copy silently reverts newer logic (`reference_create_or_replace_stale_base_clobber`, `reference_inverted_version_fn_redef_clobber`).
- Migration must end with `notify pgrst, 'reload schema';` (RPC return shape changes) — else the app 404s the new shape (`feedback_postgrest_reload_after_rpc_signature`).
- New migration version must be strictly greater than every existing file under `supabase/migrations/` (latest on this base is `20260627190000`). Use `20260627200000`.
- Angular: `inject()`, `input()`/`output()`, `signal()`/`computed()`, native control flow (`@if`/`@for`), `bg-brand-*`/`text-brand-*` only, OnPush. Lint is fully ratcheted to error.
- No em dashes anywhere; no emojis; no Claude attribution in commits.
- The local Supabase Docker DB is shared across worktrees; a parallel `db reset` can wipe state (`reference_shared_local_db_contention`). Prefer `supabase db reset` to apply, and re-check if a parallel session is active.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `supabase/migrations/20260627200000_landscape_multilevel_intelligence.sql` (new) | Redefine `get_dashboard_data` (company + asset own-intel joins), `get_positioning_data` (company-own bubble flag), `get_bullseye_assets` (companies_with_intelligence). In-file smoke. | 1 |
| `src/client/src/app/core/models/company.model.ts` | Add intel fields to Company | 2 |
| `src/client/src/app/core/models/asset.model.ts` | Add intel fields to Asset | 2 |
| `src/client/src/app/core/services/dashboard.service.ts` | Map company/asset intel through | 2 |
| `src/client/src/app/core/services/dashboard.service.spec.ts` | Mapping test | 2 |
| `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts` | FlattenedTrial fields + flattening | 2 |
| `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html` | Company + asset cell marks/headlines | 2 |
| `src/client/src/app/core/models/landscape.model.ts` | `HeatmapBubble.has_intelligence` (Task 3); `BullseyeSpoke.has_intelligence` + `groupAssetsIntoSpokes` signature (Task 4) | 3, 4 |
| `src/client/src/app/features/landscape/heatmap.component.ts` | Row-label company mark | 3 |
| `src/client/src/app/features/landscape/landscape.service.ts` | Surface companies_with_intelligence | 4 |
| `src/client/src/app/features/landscape/landscape.component.ts` | Thread companies_with_intelligence into grouping | 4 |
| `src/client/src/app/features/landscape/bullseye-chart.component.ts` | Spoke-label intel flag | 4 |
| `src/client/src/app/features/landscape/bullseye-chart.component.html` | Spoke-label mark | 4 |

---

## Task 1: Migration — landscape RPCs emit multi-level intelligence

**Files:**
- Create: `supabase/migrations/20260627200000_landscape_multilevel_intelligence.sql`

**Interfaces:**
- Produces (consumed by Tasks 2-4 via PostgREST JSON):
  - `get_dashboard_data`: each company object gains `has_intelligence` (bool), `intelligence_headline` (text|null); each asset object gains the same two keys.
  - `get_positioning_data`: each bubble object gains `has_intelligence` (bool) — true only when `p_grouping = 'company'` and that company has a published company-anchored brief.
  - `get_bullseye_assets`: top-level payload gains `companies_with_intelligence` (uuid[] as jsonb array) — company ids with a published company anchor in the space.

- [ ] **Step 1: Read the authoritative base bodies from committed migrations**

Do NOT dump from a live DB (the shared local DB is polluted by parallel sessions; the dev DB is behind this base). Read each function's newest committed definition and copy it verbatim as the base for the `create or replace`:

- `get_dashboard_data` → `supabase/migrations/20260627180000_fix_get_dashboard_data_unspecified_clobber.sql`
- `get_positioning_data` → `supabase/migrations/20260627130600_intelligence_feed_and_landscape_multi.sql`
- `get_bullseye_assets` → `supabase/migrations/20260627130900_fix_asset_entity_type_anchors.sql`

Copy each function body exactly as it appears in those files; the additive edits below are anchored to text those bodies contain.

- [ ] **Step 2: Write the migration — header + `get_dashboard_data`**

Create the file. Paste the live `get_dashboard_data` body verbatim under a `create or replace`, then apply exactly these two additive changes.

(a) **Company-own intelligence.** The body has `from public.companies c cross join lateral ( select jsonb_build_object('id', c.id, ... ) as company_obj )`. Insert a lateral join immediately before that `cross join lateral`, and add two keys to the company `jsonb_build_object`:

```sql
  from public.companies c
  left join lateral (
    select pi.headline
    from public.primary_intelligence_anchors a_pi
    join public.primary_intelligence pi
      on pi.anchor_id = a_pi.id and pi.state = 'published'
    where a_pi.entity_type = 'company'
      and a_pi.entity_id   = c.id
      and a_pi.space_id    = p_space_id
    order by a_pi.is_lead desc, pi.published_at desc nulls last
    limit 1
  ) pi_company on true
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'has_intelligence', (pi_company.headline is not null),
      'intelligence_headline', pi_company.headline,
      'assets', coalesce((
      ...
```

(b) **Asset-own intelligence.** The body has `from public.assets a cross join lateral ( select jsonb_build_object('id', a.id, ... ) as asset_obj )`. Insert a lateral join before that `cross join lateral`, and add two keys to the asset `jsonb_build_object` (note `entity_type = 'product'`):

```sql
        from public.assets a
        left join lateral (
          select pi.headline
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi
            on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.entity_type = 'product'
            and a_pi.entity_id   = a.id
            and a_pi.space_id    = p_space_id
          order by a_pi.is_lead desc, pi.published_at desc nulls last
          limit 1
        ) pi_asset on true
        cross join lateral (
          select jsonb_build_object(
            'id', a.id,
            'name', a.name,
            'generic_name', a.generic_name,
            'logo_url', a.logo_url,
            'display_order', a.display_order,
            'has_intelligence', (pi_asset.headline is not null),
            'intelligence_headline', pi_asset.headline,
            'mechanisms_of_action', coalesce((
            ...
```

Leave the rest (indications, trials, `pi_trial`, markers, the `where` clauses on `c` and `a`) byte-for-byte unchanged. Keep the `comment on function` line; extend its text to mention company/asset presence.

- [ ] **Step 3: Write the migration — `get_positioning_data`**

Paste the live body under `create or replace`. In the final `select coalesce(jsonb_agg( jsonb_build_object( 'label', ba.group_label, ... 'phase_counts', ba.phase_counts ) ...))` add one key to the per-bubble object:

```sql
        'intelligence_count', ba.intelligence_count,
        'has_intelligence', case when p_grouping = 'company' then exists (
          select 1
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi
            on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.space_id    = p_space_id
            and a_pi.entity_type = 'company'
            and a_pi.entity_id   = (ba.group_keys->>'company_id')::uuid
        ) else false end,
        'phase_counts', ba.phase_counts
```

Do not touch `intelligence_count` (that is the existing assets-with-intelligence roll-up; the new `has_intelligence` is the distinct company-own flag).

- [ ] **Step 4: Write the migration — `get_bullseye_assets`**

Paste the live body under `create or replace`. The function returns `jsonb_build_object('assets', ...)`. Add one sibling key:

```sql
  return jsonb_build_object(
    'assets', ...,
    'companies_with_intelligence', coalesce((
      select jsonb_agg(distinct a_pi.entity_id)
      from public.primary_intelligence_anchors a_pi
      join public.primary_intelligence pi
        on pi.anchor_id = a_pi.id and pi.state = 'published'
      where a_pi.space_id    = p_space_id
        and a_pi.entity_type = 'company'
    ), '[]'::jsonb)
  );
```

(Match the function's actual return statement; if it builds the object into a variable then returns it, add the key in the build.)

- [ ] **Step 5: Write the in-file smoke block**

Append a `do $$ ... $$;` block that seeds one published company anchor and one published asset (`product`) anchor for a known space/company/asset, then asserts. Model the seed on the existing smoke in `20260627130600_intelligence_feed_and_landscape_multi.sql` (lines ~1426-1456: insert into `primary_intelligence_anchors` then `primary_intelligence` with `state='published'`). Assertions:

```sql
do $$
declare
  v_space uuid; v_company uuid; v_asset uuid; v_owner uuid;
  v_anchor uuid; v_dash jsonb; v_pos jsonb; v_company_obj jsonb; v_asset_obj jsonb;
begin
  -- pick any space with a company+asset, and its owner; skip smoke if none
  select c.space_id, c.id, a.id into v_space, v_company, v_asset
  from public.companies c
  join public.assets a on a.company_id = c.id and a.space_id = c.space_id
  limit 1;
  if v_space is null then raise notice 'multilevel-intel smoke: no fixture data, skipping'; return; end if;
  select created_by into v_owner from public.companies where id = v_company;

  -- seed company anchor + published version
  insert into public.primary_intelligence_anchors (space_id, entity_type, entity_id, is_lead, created_by)
    values (v_space, 'company', v_company, true, v_owner) returning id into v_anchor;
  insert into public.primary_intelligence (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space, v_anchor, 'published', 'Smoke company headline', '', '', v_owner);
  -- seed asset (product) anchor + published version
  insert into public.primary_intelligence_anchors (space_id, entity_type, entity_id, is_lead, created_by)
    values (v_space, 'product', v_asset, true, v_owner) returning id into v_anchor;
  insert into public.primary_intelligence (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space, v_anchor, 'published', 'Smoke asset headline', '', '', v_owner);

  -- dashboard: company + asset carry has_intelligence + headline
  v_dash := public.get_dashboard_data(v_space);
  v_company_obj := (select obj from jsonb_array_elements(v_dash) obj where obj->>'id' = v_company::text);
  if (v_company_obj->>'has_intelligence')::bool is not true then
    raise exception 'smoke FAIL: company has_intelligence not true';
  end if;
  if v_company_obj->>'intelligence_headline' <> 'Smoke company headline' then
    raise exception 'smoke FAIL: company headline mismatch';
  end if;
  v_asset_obj := (select a2 from jsonb_array_elements(v_company_obj->'assets') a2 where a2->>'id' = v_asset::text);
  if (v_asset_obj->>'has_intelligence')::bool is not true then
    raise exception 'smoke FAIL: asset has_intelligence not true';
  end if;

  -- positioning: company-grouped bubble carries has_intelligence; non-company grouping does not
  v_pos := public.get_positioning_data(v_space, 'company');
  if not exists (
    select 1 from jsonb_array_elements(v_pos->'bubbles') b
    where (b->'group_keys'->>'company_id') = v_company::text and (b->>'has_intelligence')::bool is true
  ) then
    raise exception 'smoke FAIL: company-grouped bubble missing has_intelligence';
  end if;
  v_pos := public.get_positioning_data(v_space, 'moa');
  if exists (select 1 from jsonb_array_elements(v_pos->'bubbles') b where (b->>'has_intelligence')::bool is true) then
    raise exception 'smoke FAIL: moa grouping should not set company has_intelligence';
  end if;

  raise notice 'multilevel-intel smoke: PASS';
  rollback;  -- leave no seed residue
exception when others then
  rollback;
  raise;
end $$;
```

Note: if the seed columns differ from the real schema (check `\d primary_intelligence` / `primary_intelligence_anchors`), adjust to actual NOT NULL columns. Do not call secret-gated RPC wrappers in the smoke (`reference_migration_smoke_secret_gotcha`).

End the file with:

```sql
notify pgrst, 'reload schema';
```

- [ ] **Step 6: Apply and verify the migration**

```bash
supabase db reset
```
Expected: completes without error; you see `multilevel-intel smoke: PASS` (or the no-fixture skip notice) in the output.

- [ ] **Step 7: Advisor + arch regen**

```bash
supabase db advisors --local --type all
cd src/client && npm run docs:arch
```
Expected: no new advisor warnings; arch regen touches `docs/runbook/06-backend-architecture.md` etc.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260627200000_landscape_multilevel_intelligence.sql docs/runbook
git commit -m "feat(landscape): emit company + asset intelligence from dashboard/positioning/bullseye RPCs"
```

---

## Task 2: Timeline — render company + asset intelligence in the frozen-pane cells

**Files:**
- Modify: `src/client/src/app/core/models/company.model.ts`
- Modify: `src/client/src/app/core/models/asset.model.ts`
- Modify: `src/client/src/app/core/services/dashboard.service.ts:72-123`
- Test: `src/client/src/app/core/services/dashboard.service.spec.ts`
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts:40-55,187-205`
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html:141-176`

**Interfaces:**
- Consumes (from Task 1): company/asset objects with `has_intelligence`, `intelligence_headline`.
- Produces: `FlattenedTrial` gains `companyHasIntelligence`, `companyIntelligenceHeadline`, `assetHasIntelligence`, `assetIntelligenceHeadline`.

- [ ] **Step 1: Write the failing mapping test**

In `dashboard.service.spec.ts`, add (mirror the existing `mapDashboardCompanies` tests):

```ts
it('maps company and asset intelligence presence + headline through', () => {
  const out = mapDashboardCompanies([
    {
      id: 'c1', name: 'Novo', logo_url: null,
      has_intelligence: true, intelligence_headline: 'Co headline',
      assets: [
        {
          id: 'a1', name: 'Sema',
          has_intelligence: true, intelligence_headline: 'Asset headline',
          indications: [], trials: [],
        },
      ],
    },
  ]);
  expect(out[0].has_intelligence).toBe(true);
  expect(out[0].intelligence_headline).toBe('Co headline');
  expect(out[0].assets[0].has_intelligence).toBe(true);
  expect(out[0].assets[0].intelligence_headline).toBe('Asset headline');
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
cd src/client && npx vitest run src/app/core/services/dashboard.service.spec.ts -t "maps company and asset intelligence"
```
Expected: FAIL (`intelligence_headline` undefined — the asset map rebuilds objects and drops it).

- [ ] **Step 3: Models — add fields**

`company.model.ts`: add inside the `Company` interface:
```ts
  // company owns published primary intelligence; intelligence_headline carries the
  // lead brief's headline (fallback most-recent published). See landscape multilevel intel.
  has_intelligence?: boolean;
  intelligence_headline?: string | null;
```
`asset.model.ts`: add the identical two fields to the `Asset` interface.

- [ ] **Step 4: Service — map fields through**

In `dashboard.service.ts`, company map (the `(data ?? []).map((c: any) => ({ ...c,` object) add after `...c,`:
```ts
    has_intelligence: c.has_intelligence ?? false,
    intelligence_headline: c.intelligence_headline ?? null,
```
In the asset return object (`return { ...p,`) add after `...p,`:
```ts
        has_intelligence: p.has_intelligence ?? false,
        intelligence_headline: p.intelligence_headline ?? null,
```

- [ ] **Step 5: Run the test — verify it passes**

```bash
cd src/client && npx vitest run src/app/core/services/dashboard.service.spec.ts -t "maps company and asset intelligence"
```
Expected: PASS.

- [ ] **Step 6: FlattenedTrial — add fields + populate**

`dashboard-grid.component.ts`, in `interface FlattenedTrial` (after `isLastInCompany`):
```ts
  companyHasIntelligence: boolean;
  companyIntelligenceHeadline: string | null;
  assetHasIntelligence: boolean;
  assetIntelligenceHeadline: string | null;
```
In the `flattenedTrials` `rows.push({ ... })` object (after `companyLogoUrl` / `assetLogoUrl` lines), add:
```ts
            companyHasIntelligence: company.has_intelligence ?? false,
            companyIntelligenceHeadline: company.intelligence_headline ?? null,
            assetHasIntelligence: asset.has_intelligence ?? false,
            assetIntelligenceHeadline: asset.intelligence_headline ?? null,
```

- [ ] **Step 7: Template — company cell mark + headline**

In `dashboard-grid.component.html`, replace the `@if (row.isFirstInCompany) { ... }` block (lines 141-157) with a flex-col that carries the name, an inline mark, and the toggled headline:

```html
                @if (row.isFirstInCompany) {
                  @if (row.companyLogoUrl) {
                    <app-brand-logo
                      [url]="row.companyLogoUrl"
                      [alt]="row.companyName"
                      [width]="20"
                      [height]="20"
                      imgClass="h-5 w-5 rounded object-contain flex-none"
                    />
                  }
                  @if (!isScrolled()) {
                    <div class="flex min-w-0 flex-col justify-center">
                      <span class="flex min-w-0 items-center gap-1">
                        <span
                          class="font-bold text-[11px] uppercase tracking-wider text-slate-700 truncate"
                          >{{ row.companyName }}</span
                        >
                        @if (row.companyHasIntelligence) {
                          <app-pi-mark [size]="10" class="shrink-0" />
                        }
                      </span>
                      @if (
                        showIntelligenceHeadlines() &&
                        row.companyHasIntelligence &&
                        row.companyIntelligenceHeadline
                      ) {
                        <span
                          class="flex min-w-0 items-center gap-1 text-[10px] leading-tight text-brand-700"
                        >
                          <app-pi-mark [size]="9" class="shrink-0" />
                          <span class="truncate">{{ row.companyIntelligenceHeadline }}</span>
                        </span>
                      }
                    </div>
                  }
                }
```

- [ ] **Step 8: Template — asset cell mark + headline**

Replace the asset `@if (row.isFirstInAsset) { ... }` block (lines 171-175) with:

```html
                @if (row.isFirstInAsset) {
                  <div class="flex min-w-0 flex-col justify-center">
                    <span class="flex min-w-0 items-center gap-1">
                      <span class="text-sm text-slate-600 font-medium truncate">{{
                        row.assetName
                      }}</span>
                      @if (row.assetHasIntelligence) {
                        <app-pi-mark [size]="10" class="shrink-0" />
                      }
                    </span>
                    @if (
                      showIntelligenceHeadlines() &&
                      row.assetHasIntelligence &&
                      row.assetIntelligenceHeadline
                    ) {
                      <span
                        class="flex min-w-0 items-center gap-1 text-[10px] leading-tight text-brand-700"
                      >
                        <app-pi-mark [size]="9" class="shrink-0" />
                        <span class="truncate">{{ row.assetIntelligenceHeadline }}</span>
                      </span>
                    }
                  </div>
                }
```

(`PiMarkComponent` and `showIntelligenceHeadlines` are already imported/used by the trial cell — no new imports.)

- [ ] **Step 9: Lint + build**

```bash
cd src/client && ng lint && ng build
```
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/client/src/app/core/models/company.model.ts src/client/src/app/core/models/asset.model.ts \
        src/client/src/app/core/services/dashboard.service.ts src/client/src/app/core/services/dashboard.service.spec.ts \
        src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts \
        src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
git commit -m "feat(timeline): show company and asset intelligence marks and headlines per cell"
```

---

## Task 3: Heatmap — company intelligence mark on the row label

**Files:**
- Modify: `src/client/src/app/core/models/landscape.model.ts` (`HeatmapBubble`, ~line 449-460)
- Modify: `src/client/src/app/features/landscape/heatmap.component.ts:366-377`

**Interfaces:**
- Consumes (from Task 1): each bubble carries `has_intelligence` (true only under company grouping).
- Produces: none downstream.

- [ ] **Step 1: Model — add field**

In `landscape.model.ts`, `HeatmapBubble` interface, add:
```ts
  // company-anchored intelligence presence; set by get_positioning_data only when
  // grouped by company. Distinct from intelligence_count (assets-with-intelligence).
  has_intelligence?: boolean;
```

- [ ] **Step 2: Template — render mark after the row label**

In `heatmap.component.ts`, the row label `<td>` (lines 366-377): add a mark right after the `row-label-text` span (it flows true only under company grouping, so no grouping check needed in the template):

```html
              <td>
                <span
                  class="row-label-text"
                  [pTooltip]="row.bubble.label"
                  tooltipPosition="top"
                  >{{ row.bubble.label }}</span
                >
                @if (row.bubble.has_intelligence) {
                  <app-pi-mark [size]="9" class="ml-1 inline-block align-middle" />
                }
                <div class="row-label-sub">
                  {{ row.bubble.competitor_count }}
                  {{ row.bubble.competitor_count === 1 ? 'company' : 'companies' }}
                </div>
              </td>
```

(`PiMarkComponent` is already imported in this component — the cell badge uses `<app-pi-mark>`. Verify the import is present; if not, add it to `imports`.)

- [ ] **Step 3: Lint + build**

```bash
cd src/client && ng lint && ng build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts src/client/src/app/features/landscape/heatmap.component.ts
git commit -m "feat(heatmap): show company intelligence mark on company-grouped row labels"
```

---

## Task 4: Bullseye — company intelligence mark on the spoke label (company grouping)

**Files:**
- Modify: `src/client/src/app/core/models/landscape.model.ts` (`BullseyeSpoke` + `groupAssetsIntoSpokes`, ~lines 161-167, 366-426)
- Modify: `src/client/src/app/features/landscape/landscape.service.ts:83-110`
- Modify: `src/client/src/app/features/landscape/landscape.component.ts:91-134`
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.ts:55,231-245`
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.html:68-83`

**Interfaces:**
- Consumes (from Task 1): `get_bullseye_assets` payload `{ assets, companies_with_intelligence }`.
- Produces: `BullseyeSpoke.has_intelligence?: boolean`; `groupAssetsIntoSpokes(assets, grouping, companiesWithIntelligence?)`.

- [ ] **Step 1: Model — spoke field + grouping uses company-intel set**

In `landscape.model.ts`, add to `BullseyeSpoke`:
```ts
  has_intelligence?: boolean;
```
Change `groupAssetsIntoSpokes` signature to accept the company-intel ids and set the flag for company spokes only. Locate the function (the spokes are built from a `Map`; `getSpokeKeys` returns `{ id, name }` and for `'company'` the id is `company_id`). Update the signature and the spoke construction:
```ts
export function groupAssetsIntoSpokes(
  assets: BullseyeAsset[],
  grouping: SpokeGrouping,
  companiesWithIntelligence: ReadonlySet<string> = new Set(),
): { spokes: BullseyeSpoke[]; duplicatedAssetIds: Set<string> } {
```
Where each spoke object is built, add:
```ts
      has_intelligence: grouping === 'company' && companiesWithIntelligence.has(id),
```
(where `id` is the spoke/group id, which equals `company_id` under company grouping).

- [ ] **Step 2: Service — return companies_with_intelligence**

In `landscape.service.ts`, change `getBullseyeAssets` to return both arrays. Update its return type to `Promise<{ assets: BullseyeAsset[]; companiesWithIntelligence: string[] }>` and the fetch body:
```ts
          const result = data as { assets: BullseyeAsset[]; companies_with_intelligence?: string[] };
          return {
            assets: result.assets,
            companiesWithIntelligence: result.companies_with_intelligence ?? [],
          };
```
Keep the cache key/tags unchanged.

- [ ] **Step 3: Landscape component — thread the set into grouping**

In `landscape.component.ts`, the `bullseyeAssets` resource loader now returns the object; update `groupedResult` to read both:
```ts
  private readonly groupedResult = computed(() => {
    const result = this.bullseyeAssets.value();
    if (!result) return null;
    const { assets, companiesWithIntelligence } = result;
    if (assets.length === 0)
      return { spokes: [] as BullseyeSpoke[], duplicatedAssetIds: new Set<string>() };
    return groupAssetsIntoSpokes(
      assets,
      this.state.spokeGrouping(),
      new Set(companiesWithIntelligence),
    );
  });
```
Update any other reader of `bullseyeAssets.value()` (e.g. empty-state checks, asset counts) to use `.assets`. Grep within the file for `bullseyeAssets.value()` and fix each call site.

- [ ] **Step 4: Bullseye chart — carry flag to label spec**

In `bullseye-chart.component.ts`, add to `interface SpokeLabelSpec`:
```ts
  hasIntelligence: boolean;
```
In the `spokeLabels` computed `.map`, add to the returned object:
```ts
      hasIntelligence: s.has_intelligence ?? false,
```

- [ ] **Step 5: Bullseye chart — render mark on the spoke label**

In `bullseye-chart.component.html`, the spoke label `@for` (lines 68-83): wrap the `<text>` and add a mark when `label.hasIntelligence`. Reuse the existing `bookmarkPath` / `bookmarkScale` used by the dot PI badge:
```html
        @for (label of spokeLabels(); track label.id) {
          <text
            [attr.x]="label.x"
            [attr.y]="label.y"
            [attr.text-anchor]="label.anchor"
            [attr.transform]="'rotate(' + label.rotate + ' ' + label.x + ' ' + label.y + ')'"
            fill="#334155"
            font-size="16"
            font-weight="600"
            letter-spacing="1.4"
            dominant-baseline="middle"
          >
            {{ label.name }}
          </text>
          @if (label.hasIntelligence) {
            <g
              role="img"
              aria-label="Company has primary intelligence"
              class="pi-badge"
              [attr.transform]="
                'translate(' + label.x + ',' + (label.y - 14) + ') scale(' + bookmarkScale + ')'
              "
            >
              <path
                [attr.d]="bookmarkPath"
                fill="var(--brand-600)"
                stroke="#ffffff"
                stroke-width="2"
                stroke-linejoin="round"
              />
            </g>
          }
        }
```
(If `bookmarkPath`/`bookmarkScale` are `protected`/private to the component, they are already used by the dot badge template so they are template-visible. Adjust the translate offset visually in Step 7.)

- [ ] **Step 6: Lint + build**

```bash
cd src/client && ng lint && ng build
```
Expected: clean. Fix any missed `bullseyeAssets.value()` call sites the compiler flags.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts \
        src/client/src/app/features/landscape/landscape.service.ts \
        src/client/src/app/features/landscape/landscape.component.ts \
        src/client/src/app/features/landscape/bullseye-chart.component.ts \
        src/client/src/app/features/landscape/bullseye-chart.component.html
git commit -m "feat(bullseye): show company intelligence mark on company-grouped spoke labels"
```

---

## Task 5: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the app against local Supabase** (or push to dev and use the live space).

- [ ] **Step 2: Verify on the Novo Nordisk space** (`ca340e7c-…`, company `a3037207-…`, 3 published company anchors):
  - Timeline: the Novo Nordisk company cell shows a PI mark; toggling "Intelligence headlines" ON shows the lead company headline as a second line under the company name. Asset cells with asset-anchored intelligence behave the same.
  - Heatmap grouped by company: the Novo Nordisk row label shows a PI mark; grouped by MOA/indication, no company mark appears.
  - Bullseye grouped by company: the Novo Nordisk spoke label shows the mark; other groupings do not.

- [ ] **Step 3: Confirm no regression** in the existing trial mark/headline and the existing asset dot / heatmap cell badges.

---

## Self-review notes

- Spec coverage: timeline company+asset (Task 2), heatmap company grouping (Task 3), bullseye company grouping (Task 4), RPCs (Task 1), tests (Task 1 smoke + Task 2 mapping spec), manual verify (Task 5). All spec sections covered.
- Entity-type trap: asset join uses `'product'` (Task 1 Step 2b), company uses `'company'` (2a, 3, 4) — explicit.
- The bullseye uses the company-OWN intel set (Task 1 `companies_with_intelligence`), not the asset roll-up the data already carries — matches the approved "strictly per-level" decision.
- Type consistency: `has_intelligence`/`intelligence_headline` used identically across Company/Asset models, FlattenedTrial (`companyHasIntelligence` etc.), and templates; `groupAssetsIntoSpokes` third arg threaded service → component → model.
