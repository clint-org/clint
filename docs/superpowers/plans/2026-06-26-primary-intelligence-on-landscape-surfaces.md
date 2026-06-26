# Primary Intelligence on Landscape Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface "primary intelligence" (PI) consistently across the timeline, bullseye, and heatmap landscape surfaces using one shared brand-colored bookmark presence mark and one shared detail-pane component, with correct owner (trial/asset) vs reference (marker) semantics.

**Architecture:** Two new shared presentational components — `PiMark` (the bookmark glyph, single source of shape) and `PiDetailSection` (PI block + reference list with count) — slot into each surface's existing container. A single new migration extends two read-path RPCs (`get_dashboard_data`, `get_positioning_data`) with per-trial / per-asset `has_intelligence` presence flags so marks render from already-loaded data without per-hover RPC calls. Marker references and trial/asset PI prose load on selection via existing RPCs.

**Tech Stack:** Angular 19 standalone components + signals, PrimeNG, Tailwind v4 (`bg-brand-*` / `--brand-*`), Supabase/Postgres RPCs, Vitest (`npm run test:units`).

## Global Constraints

- **No emoji** anywhere (UI, code, commit messages). No em dashes (`—`); use commas/colons/periods.
- **No Claude attribution** in commit messages.
- **Whitelabel color rule:** the PI mark fill, PI detail block, reference cards, headline text, and any "PI" affordance use `--brand-*` / `bg-brand-*` / `text-brand-*` / `border-brand-*` / `ring-brand-*`. NEVER `teal-*`. Data colors stay hardcoded: marker hues (green/slate/orange/blue/violet/amber), phase tints (slate/cyan/teal/violet/amber), activity orange (`#f97316`). PrimeNG tokens reference `{primary.X}`, never `{teal.X}`.
- **Signal is form + outline + text, not hue alone:** bookmark glyph (non-circular) + mandatory white (1px-equivalent) stroke + brand fill, **static**. Recent activity stays a hollow **pulsing** orange ring. The two never collide (form + motion differ).
- **Accessibility:** not color-only (shape + white outline +, on timeline, headline text); every mark carries `aria-label="Has primary intelligence"`; activity ring keeps its own label; WCAG AA contrast holds via the white outline on any brand hue / background / same-hue phase tint. Detail panes keep keyboard/focus/escape behavior; reference cards are focusable where they link out.
- **Angular signal rule:** any plain prop bound via `[(ngModel)]` that participates in a `computed()` MUST be a signal.
- **Audit fields server-side only:** never trust client-supplied created_by/updated_by/timestamps (not relevant to this plan's RPCs, which are read-only, but keep in mind).
- **Owner vs reference (do not blur):** a trial/asset OWNS its PI (entity_type `'trial'` / `'product'`), shown on the row/node and as a PI block in its pane. A marker shows INCOMING references (PI entries that link to it via `primary_intelligence_links`), shown as a counted reference list. Markers never own PI.
- **No new core RPCs** beyond the two read-path extensions in Task 3. Marker references use existing `list_primary_intelligence(p_referencing_entity_type => 'marker', ...)`. Trial PI uses existing `get_trial_detail_with_intelligence`. Asset notes use existing `get_intelligence_notes_for_asset`.
- **Verification commands** (run from `src/client/`): `ng lint`, `ng build`, `npm run test:units`. After any migration: `supabase db advisors --local --type all` and `npm run docs:arch` (regen architecture docs, commit in same change set). Caution: all worktrees share ONE local Supabase Docker DB; verify migration smoke in isolation. Pre-push e2e hook is flaky on cold starts; CI is canonical.

## File Structure

**New files:**
- `src/client/src/app/shared/components/pi-mark/pi-mark.component.ts` — bookmark glyph component + exported `BOOKMARK_PATH` / `PI_MARK_VIEWBOX` shape constants (single source of shape).
- `src/client/src/app/shared/components/pi-mark/pi-mark.component.spec.ts`
- `src/client/src/app/shared/components/pi-detail-section/pi-detail-section.component.ts` — PI block (headline + summary) + reference list with optional count.
- `src/client/src/app/shared/components/pi-detail-section/pi-detail-section.component.spec.ts`
- `supabase/migrations/20260626150000_landscape_primary_intelligence_presence.sql` — extends `get_dashboard_data` + `get_positioning_data`.

**Modified files:**
- `src/client/src/app/core/models/primary-intelligence.model.ts` — add `PiReference` type.
- `src/client/src/app/core/models/trial.model.ts` — add `has_intelligence` + `intelligence_headline`.
- `src/client/src/app/core/models/landscape.model.ts` — add `has_intelligence` to `HeatmapAsset`, `intelligence_count` to `HeatmapBubble`.
- `src/client/src/app/core/services/dashboard.service.ts` — map new trial fields.
- `src/client/src/app/core/services/landscape.service.ts` — map new heatmap fields.
- `src/client/src/app/core/services/primary-intelligence.service.ts` — widen `list()` referencing type; add `getMarkerReferences()`.
- `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts` / `.html` — trial-row mark + headline + density toggle input.
- `src/client/src/app/features/dashboard/grid/marker.component.ts` / `.html` — thread `intelligenceHeadline` to tooltip.
- `src/client/src/app/features/landscape/timeline-view.component.ts` / `.html` — density toggle persistence; trial-click opens PI pane.
- `src/client/src/app/features/landscape/landscape-state.service.ts` — marker references on marker select; `selectTrial()` + trial detail.
- `src/client/src/app/features/landscape/landscape-shell.component.ts` — render trial PI pane branch.
- `src/client/src/app/shared/components/marker-detail-content.component.ts` — Referenced-in reference list.
- `src/client/src/app/features/landscape/bullseye-signal-mark.component.ts` — remove blue intel ring.
- `src/client/src/app/features/landscape/bullseye-chart.component.ts` / `.html` — remove blue halo, add brand bookmark badge.
- `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts` / `.html` — intelligence section -> PiDetailSection.
- `src/client/src/app/features/landscape/heatmap.component.ts` — cell bookmark flag.
- `src/client/src/app/features/landscape/heatmap-detail-panel.component.ts` — intelligence section via PiDetailSection.

---

## Task 1: `PiMark` shared bookmark glyph + shape constants

**Files:**
- Create: `src/client/src/app/shared/components/pi-mark/pi-mark.component.ts`
- Test: `src/client/src/app/shared/components/pi-mark/pi-mark.component.spec.ts`

**Interfaces:**
- Produces:
  - `export const BOOKMARK_PATH: string` — SVG path `d` for the bookmark within a 24x24 viewBox.
  - `export const PI_MARK_VIEWBOX = '0 0 24 24'`.
  - `PiMarkComponent` (selector `app-pi-mark`, standalone, `ChangeDetectionStrategy.OnPush`):
    - `size = input<number>(11)` — rendered px (width = height).
    - `label = input<string>('Has primary intelligence')` — aria-label.
    - Renders an inline `<svg role="img" [attr.aria-label]="label()" [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="viewBox">` containing one `<path [attr.d]="path" fill="var(--brand-600)" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />`. `stroke-width="2"` in a 24-unit viewBox renders ~1px at 11px display (the mandatory white outline).
- Consumes: nothing.

The bookmark shape: a classic ribbon bookmark with a notched bottom. Use this path (top corners slightly rounded, V-notch at bottom):

```
M6 3 h12 a1 1 0 0 1 1 1 v16 l-7 -4 -7 4 v-16 a1 1 0 0 1 1 -1 z
```

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/shared/components/pi-mark/pi-mark.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { BOOKMARK_PATH, PiMarkComponent } from './pi-mark.component';

@Component({
  standalone: true,
  imports: [PiMarkComponent],
  template: `<app-pi-mark [size]="size" [label]="label" />`,
})
class HostComponent {
  size = 11;
  label = 'Has primary intelligence';
}

describe('PiMarkComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('renders an svg with the bookmark path, brand fill, and white outline', () => {
    const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg');
    expect(svg).toBeTruthy();
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('d')).toBe(BOOKMARK_PATH);
    expect(path.getAttribute('fill')).toBe('var(--brand-600)');
    expect(path.getAttribute('stroke')).toBe('#ffffff');
  });

  it('exposes an accessible label and reflects size', () => {
    const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Has primary intelligence');
    expect(svg.getAttribute('width')).toBe('11');
    expect(svg.getAttribute('height')).toBe('11');
  });

  it('updates the label and size from inputs', () => {
    fixture.componentInstance.size = 16;
    fixture.componentInstance.label = 'Asset has intelligence';
    fixture.detectChanges();
    const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('aria-label')).toBe('Asset has intelligence');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- pi-mark`
Expected: FAIL ("Cannot find module './pi-mark.component'").

- [ ] **Step 3: Write minimal implementation**

Create `src/client/src/app/shared/components/pi-mark/pi-mark.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Single source of truth for the PI bookmark shape (24x24 viewBox). */
export const BOOKMARK_PATH =
  'M6 3 h12 a1 1 0 0 1 1 1 v16 l-7 -4 -7 4 v-16 a1 1 0 0 1 1 -1 z';
export const PI_MARK_VIEWBOX = '0 0 24 24';

/**
 * The primary-intelligence presence glyph: a brand-filled bookmark with a
 * mandatory white outline. The non-circular shape plus the outline carry the
 * signal independent of hue, so it never collides with circular markers,
 * node dots, the activity ring, or same-hue phase tints. Static by design;
 * motion is reserved for the activity signal.
 */
@Component({
  selector: 'app-pi-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      role="img"
      [attr.aria-label]="label()"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      class="inline-block shrink-0 align-[-0.125em]"
    >
      <path
        [attr.d]="path"
        fill="var(--brand-600)"
        stroke="#ffffff"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  `,
})
export class PiMarkComponent {
  readonly size = input<number>(11);
  readonly label = input<string>('Has primary intelligence');
  protected readonly path = BOOKMARK_PATH;
  protected readonly viewBox = PI_MARK_VIEWBOX;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- pi-mark`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/pi-mark/
git commit -m "feat(landscape): add shared PiMark bookmark glyph for primary intelligence"
```

---

## Task 2: `PiReference` model type + `PiDetailSection` shared component

**Files:**
- Modify: `src/client/src/app/core/models/primary-intelligence.model.ts` (append `PiReference`)
- Create: `src/client/src/app/shared/components/pi-detail-section/pi-detail-section.component.ts`
- Test: `src/client/src/app/shared/components/pi-detail-section/pi-detail-section.component.spec.ts`

**Interfaces:**
- Consumes: `PiMarkComponent`, `BOOKMARK_PATH` (Task 1); `ENTITY_TYPE_LABEL`, `IntelligenceEntityType`, `IntelligenceLinkEntityType` (existing model).
- Produces:
  - In `primary-intelligence.model.ts`:
    ```typescript
    /** One normalized row in a PI reference list (owner of a citing PI entry). */
    export interface PiReference {
      /** PI row id. */
      id: string;
      entity_type: IntelligenceEntityType | IntelligenceLinkEntityType;
      /** Owner entity id (trial/asset/company the PI is about) for navigation. */
      entity_id: string;
      /** Resolved owner name when the surface has it; otherwise null. */
      entity_name: string | null;
      headline: string;
    }
    ```
  - `PiDetailSectionComponent` (selector `app-pi-detail-section`, standalone, OnPush):
    - `headline = input<string | null>(null)` — owned-PI headline (owner mode).
    - `summary = input<string | null>(null)` — owned-PI summary text (plain, already-stripped; pass `summary_md` for now).
    - `references = input<PiReference[]>([])` — incoming references.
    - `countLabel = input<string | null>(null)` — explicit count line, e.g. `"Referenced in 3 intelligence entries"` or `"2 of 5 assets have intelligence"`. When null and references exist, no count line is shown (owner-only surfaces).
    - `referenceClick = output<PiReference>()` — emitted when a reference row is activated.
    - Renders nothing when `headline()` is null AND `references().length === 0` AND `countLabel()` is null (host decides whether to wrap in a section).

- [ ] **Step 1: Add the `PiReference` type**

In `src/client/src/app/core/models/primary-intelligence.model.ts`, after the `AssetIntelligenceNote` interface (around line 136), add:

```typescript
/** One normalized row in a PI reference list (owner of a citing PI entry). */
export interface PiReference {
  /** PI row id. */
  id: string;
  entity_type: IntelligenceEntityType | IntelligenceLinkEntityType;
  /** Owner entity id (trial/asset/company the PI is about) for navigation. */
  entity_id: string;
  /** Resolved owner name when the surface has it; otherwise null. */
  entity_name: string | null;
  headline: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/client/src/app/shared/components/pi-detail-section/pi-detail-section.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { PiDetailSectionComponent } from './pi-detail-section.component';
import { PiReference } from '../../../core/models/primary-intelligence.model';

@Component({
  standalone: true,
  imports: [PiDetailSectionComponent],
  template: `
    <app-pi-detail-section
      [headline]="headline"
      [summary]="summary"
      [references]="references"
      [countLabel]="countLabel"
      (referenceClick)="clicked = $event"
    />
  `,
})
class HostComponent {
  headline: string | null = null;
  summary: string | null = null;
  references: PiReference[] = [];
  countLabel: string | null = null;
  clicked: PiReference | null = null;
}

describe('PiDetailSectionComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
  });

  it('renders the owned PI block with mark, headline, and summary', () => {
    fixture.componentInstance.headline = 'GLP-1 lead extends cardiovascular edge';
    fixture.componentInstance.summary = 'Phase III readout reinforces the franchise.';
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-pi-mark')).toBeTruthy();
    expect(el.textContent).toContain('GLP-1 lead extends cardiovascular edge');
    expect(el.textContent).toContain('Phase III readout reinforces the franchise.');
  });

  it('renders a counted reference list and emits on row activation', () => {
    fixture.componentInstance.references = [
      { id: 'a', entity_type: 'trial', entity_id: 't1', entity_name: 'SURMOUNT-1', headline: 'Tirzepatide tops list' },
      { id: 'b', entity_type: 'product', entity_id: 'p1', entity_name: null, headline: 'Oral contender narrows gap' },
    ];
    fixture.componentInstance.countLabel = 'Referenced in 2 intelligence entries';
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Referenced in 2 intelligence entries');
    expect(el.textContent).toContain('Tirzepatide tops list');
    const rows = el.querySelectorAll('[data-pi-reference]');
    expect(rows.length).toBe(2);
    (rows[0] as HTMLElement).click();
    expect(fixture.componentInstance.clicked?.id).toBe('a');
  });

  it('renders nothing when empty', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-pi-mark')).toBeNull();
    expect(el.querySelector('[data-pi-reference]')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- pi-detail-section`
Expected: FAIL ("Cannot find module './pi-detail-section.component'").

- [ ] **Step 4: Write minimal implementation**

Create `src/client/src/app/shared/components/pi-detail-section/pi-detail-section.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  ENTITY_TYPE_LABEL,
  IntelligenceEntityType,
  IntelligenceLinkEntityType,
  PiReference,
} from '../../../core/models/primary-intelligence.model';
import { PiMarkComponent } from '../pi-mark/pi-mark.component';

/**
 * Shared primary-intelligence detail-pane block. Renders an owned-PI summary
 * (headline + summary, brand-tinted) and/or a reference list of incoming PI
 * entries with an optional count. Used by the timeline marker pane, the
 * timeline trial pane, the bullseye detail panel, and the heatmap detail panel
 * so the PI reading experience stays identical across surfaces.
 */
@Component({
  selector: 'app-pi-detail-section',
  standalone: true,
  imports: [PiMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasOwned()) {
      <div class="rounded-sm border border-brand-200 bg-brand-50 p-3">
        <div class="flex items-start gap-2">
          <app-pi-mark [size]="12" class="mt-0.5" />
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-brand-700">
              Primary intelligence
            </p>
            <p class="mt-1 text-[13px] font-medium leading-snug text-slate-800">
              {{ headline() }}
            </p>
            @if (summary()) {
              <p class="mt-1 whitespace-pre-line text-[12px] leading-snug text-slate-600">
                {{ summary() }}
              </p>
            }
          </div>
        </div>
      </div>
    }

    @if (countLabel()) {
      <p class="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-brand-700">
        <app-pi-mark [size]="10" />
        {{ countLabel() }}
      </p>
    }

    @if (references().length > 0) {
      <ul class="mt-1.5 flex flex-col gap-1" role="list">
        @for (ref of references(); track ref.id) {
          <li
            data-pi-reference
            role="button"
            tabindex="0"
            class="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-sm border border-slate-200 px-2 py-1.5 hover:border-brand-300 hover:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-500"
            (click)="referenceClick.emit(ref)"
            (keydown.enter)="referenceClick.emit(ref)"
            (keydown.space)="referenceClick.emit(ref)"
          >
            <span class="truncate text-[12px] font-medium text-slate-800">{{ ref.headline }}</span>
            <span class="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span
                class="shrink-0 rounded-sm bg-brand-50 px-1 py-px text-[10px] font-medium text-brand-700"
                >{{ label(ref.entity_type) }}</span
              >
              @if (ref.entity_name) {
                <span class="truncate">{{ ref.entity_name }}</span>
              }
            </span>
          </li>
        }
      </ul>
    }
  `,
})
export class PiDetailSectionComponent {
  readonly headline = input<string | null>(null);
  readonly summary = input<string | null>(null);
  readonly references = input<PiReference[]>([]);
  readonly countLabel = input<string | null>(null);
  readonly referenceClick = output<PiReference>();

  protected readonly hasOwned = computed(() => !!this.headline());

  protected label(type: IntelligenceEntityType | IntelligenceLinkEntityType): string {
    return ENTITY_TYPE_LABEL[type] ?? type;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- pi-detail-section`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/shared/components/pi-detail-section/ src/client/src/app/core/models/primary-intelligence.model.ts
git commit -m "feat(landscape): add shared PiDetailSection for primary intelligence panes"
```

---

## Task 3: Migration - presence flags on `get_dashboard_data` and `get_positioning_data`

**Files:**
- Create: `supabase/migrations/20260626150000_landscape_primary_intelligence_presence.sql`

**Interfaces:**
- Produces (RPC payload additions, consumed by Task 4):
  - `get_dashboard_data` -> each trial object gains `'has_intelligence' boolean` and `'intelligence_headline' text|null` (the published trial PI headline, or null).
  - `get_positioning_data` -> each product object in `products[]` gains `'has_intelligence' boolean`; each bubble gains `'intelligence_count' integer` (count of products in the bubble with PI).
- Notes: asset PI is `entity_type = 'product'`. Trial PI is `entity_type = 'trial'`. Only `state = 'published'` counts. Reuse the existing base/lateral structure; do not rewrite unrelated logic.

The migration is a `create or replace` of both functions. **Important:** before writing, read the current full bodies and copy them verbatim, changing only the two additive spots (see CLAUDE.md memory: `CREATE OR REPLACE stale-base clobber` and `Delegate to shared RPCs`). Read:
- `supabase/migrations/20260626120100_dashboard_data_ctgov_withdrawn.sql` (current `get_dashboard_data`)
- `supabase/migrations/20260618170000_landscape_rpcs_company_logo_url.sql` (current `get_positioning_data`)

- [ ] **Step 1: Read both current function bodies**

```bash
sed -n '/create or replace function public.get_dashboard_data/,/^\$\$/p' supabase/migrations/20260626120100_dashboard_data_ctgov_withdrawn.sql
sed -n '/create or replace function public.get_positioning_data/,/^\$\$/p' supabase/migrations/20260618170000_landscape_rpcs_company_logo_url.sql
```

Confirm: the dashboard trial object is built in a `cross join lateral (...) trial_lateral`; add a `left join lateral` for the published trial PI and two new keys. The positioning products array is `jsonb_agg(distinct jsonb_build_object('id', ag.asset_id, ...))`; the `bubble_agg` / asset CTE is where `has_intelligence` must be computed per asset, then aggregated per bubble.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260626150000_landscape_primary_intelligence_presence.sql`. Start from the verbatim current bodies, then apply exactly these two changes:

**(a) `get_dashboard_data`:** add a lateral join in the per-trial query (alongside the existing `recent` lateral):

```sql
left join lateral (
  select pi.headline
  from public.primary_intelligence pi
  where pi.entity_type = 'trial'
    and pi.entity_id   = t.id
    and pi.space_id    = p_space_id
    and pi.state       = 'published'
  order by pi.updated_at desc
  limit 1
) pi_trial on true
```

and add these two keys to the trial `jsonb_build_object` (after `'most_recent_change_event_id', ...`):

```sql
    'has_intelligence',      (pi_trial.headline is not null),
    'intelligence_headline', pi_trial.headline,
```

**(b) `get_positioning_data`:** in the CTE that produces per-asset rows (`asset_highest_phase` / the grouping CTE feeding `products`), add a correlated subquery computing `has_intelligence`:

```sql
exists (
  select 1
  from public.primary_intelligence pi
  where pi.space_id = p_space_id
    and pi.state    = 'published'
    and pi.entity_type = 'product'
    and pi.entity_id   = <asset id column>
) as has_intelligence
```

Then: include `'has_intelligence', <alias>.has_intelligence` in the product `jsonb_build_object`, and add `'intelligence_count', count(*) filter (where <alias>.has_intelligence)` (or `sum(case when ... then 1 else 0 end)`) to the bubble-level `jsonb_build_object` so the bubble carries the rollup. Match the existing CTE alias names exactly (read in Step 1).

End the migration with smoke tests and a schema reload:

```sql
-- @audit:tier1 not required: read-only RPCs, no governance mutation.

do $$
declare
  v_agency_id  uuid := 'c1700000-0000-0000-0000-000000000001';
  v_tenant_id  uuid := 'c1700000-0000-0000-0000-000000000002';
  v_owner_id   uuid := 'c1700000-0000-0000-0000-000000000003';
  v_space_id   uuid := 'c1700000-0000-0000-0000-000000000004';
  v_company_id uuid := 'c1700000-0000-0000-0000-000000000005';
  v_asset_id   uuid := 'c1700000-0000-0000-0000-000000000006';
  v_trial_id   uuid := 'c1700000-0000-0000-0000-000000000007';
  v_dash       jsonb;
  v_trial      jsonb;
  v_pos        jsonb;
  v_product    jsonb;
begin
  insert into auth.users (id, email) values (v_owner_id, 'pi-presence@example.test')
    on conflict (id) do nothing;
  insert into public.agencies (id, name, subdomain) values (v_agency_id, 'PI Presence Agency', 'pi-presence-agency')
    on conflict (id) do nothing;
  insert into public.tenants (id, agency_id, name, subdomain)
    values (v_tenant_id, v_agency_id, 'PI Presence Tenant', 'pi-presence-tenant')
    on conflict (id) do nothing;
  insert into public.spaces (id, tenant_id, name) values (v_space_id, v_tenant_id, 'PI Presence Space')
    on conflict (id) do nothing;
  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner') on conflict do nothing;
  insert into public.companies (id, space_id, name) values (v_company_id, v_space_id, 'PI Co')
    on conflict (id) do nothing;
  insert into public.assets (id, space_id, company_id, name)
    values (v_asset_id, v_space_id, v_company_id, 'PI Asset') on conflict (id) do nothing;
  insert into public.trials (id, space_id, asset_id, name, phase)
    values (v_trial_id, v_space_id, v_asset_id, 'PI Trial', 'PHASE_III') on conflict (id) do nothing;
  insert into public.primary_intelligence
    (space_id, entity_type, entity_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space_id, 'trial', v_trial_id, 'published', 'Trial PI headline', '', '', v_owner_id);
  insert into public.primary_intelligence
    (space_id, entity_type, entity_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space_id, 'product', v_asset_id, 'published', 'Asset PI headline', '', '', v_owner_id);

  -- dashboard: trial carries has_intelligence + headline
  v_dash := public.get_dashboard_data(v_space_id);
  v_trial := jsonb_path_query_first(
    v_dash, '$[*].assets[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_id));
  if v_trial is null then
    raise exception 'PI presence smoke FAIL: trial node missing in get_dashboard_data';
  end if;
  if (v_trial ->> 'has_intelligence') is distinct from 'true' then
    raise exception 'PI presence smoke FAIL: trial has_intelligence not true';
  end if;
  if (v_trial ->> 'intelligence_headline') is distinct from 'Trial PI headline' then
    raise exception 'PI presence smoke FAIL: trial intelligence_headline wrong';
  end if;

  -- positioning: product carries has_intelligence, bubble carries intelligence_count
  v_pos := public.get_positioning_data(v_space_id, 'company', 'products');
  v_product := jsonb_path_query_first(
    v_pos, '$[*].products[*] ? (@.id == $aid)',
    jsonb_build_object('aid', v_asset_id));
  if v_product is null then
    raise exception 'PI presence smoke FAIL: asset node missing in get_positioning_data';
  end if;
  if (v_product ->> 'has_intelligence') is distinct from 'true' then
    raise exception 'PI presence smoke FAIL: asset has_intelligence not true';
  end if;
  if not jsonb_path_exists(v_pos, '$[*] ? (@.intelligence_count >= 1)') then
    raise exception 'PI presence smoke FAIL: no bubble reports intelligence_count >= 1';
  end if;

  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.primary_intelligence where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.trials where id = v_trial_id;
  delete from public.assets where id = v_asset_id;
  delete from public.companies where id = v_company_id;
  delete from public.spaces where id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;

  raise notice 'landscape_primary_intelligence_presence smoke test: PASS';
end$$;

notify pgrst, 'reload schema';
```

(If the smoke insert columns do not match the live table shape, adjust to the columns the existing `20260626120100` smoke uses; mirror that migration's exact insert column lists.)

- [ ] **Step 3: Apply via db reset (isolation-safe)**

Run from repo root:

```bash
supabase db reset
```

Expected: completes; near the end you see `landscape_primary_intelligence_presence smoke test: PASS`. If a parallel session's reset interferes (see memory `Shared local DB contention`), re-run once in isolation.

- [ ] **Step 4: Run advisors**

```bash
supabase db advisors --local --type all
```

Expected: no NEW warnings attributable to this migration (read-only `create or replace`, no new tables). Advisors 0028/0029 and the two dashboard CRITICAL classes are dashboard-only; ignore locally per CLAUDE.md.

- [ ] **Step 5: Regenerate architecture docs**

```bash
cd src/client && npm run docs:arch && cd ..
```

Expected: `docs/runbook/06-backend-architecture.md` (RPC->table matrix) and `07-database-schema.md` regen with no unexpected drift. The two RPCs now reference `primary_intelligence`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260626150000_landscape_primary_intelligence_presence.sql docs/runbook/
git commit -m "feat(db): add primary-intelligence presence flags to dashboard and positioning RPCs"
```

---

## Task 4: Model fields + service mappers for presence

**Files:**
- Modify: `src/client/src/app/core/models/trial.model.ts`
- Modify: `src/client/src/app/core/models/landscape.model.ts`
- Modify: `src/client/src/app/core/services/dashboard.service.ts`
- Modify: `src/client/src/app/core/services/landscape.service.ts`
- Test: `src/client/src/app/core/services/dashboard.service.spec.ts` (create if absent) and/or a focused mapper spec.

**Interfaces:**
- Consumes: RPC payload keys from Task 3 (`has_intelligence`, `intelligence_headline` on trial; `has_intelligence` on product; `intelligence_count` on bubble).
- Produces:
  - `Trial.has_intelligence?: boolean`, `Trial.intelligence_headline?: string | null`.
  - `HeatmapAsset.has_intelligence: boolean`, `HeatmapBubble.intelligence_count: number`.
  - `mapDashboardCompanies` populates the two trial fields.
  - Heatmap mapping passes through the new fields (often automatic via spread; verify).

- [ ] **Step 1: Add model fields**

In `src/client/src/app/core/models/trial.model.ts`, add to the `Trial` interface (near `recent_changes_count`):

```typescript
  /** True when this trial owns published primary intelligence. */
  has_intelligence?: boolean;
  /** Headline of the trial's published primary intelligence, when present. */
  intelligence_headline?: string | null;
```

In `src/client/src/app/core/models/landscape.model.ts`, add to `HeatmapAsset` (after `trial_count`):

```typescript
  /** True when this asset owns published primary intelligence. */
  has_intelligence: boolean;
```

and to `HeatmapBubble` (after `unit_count`):

```typescript
  /** Count of assets in this group that own published primary intelligence. */
  intelligence_count: number;
```

- [ ] **Step 2: Write the failing mapper test**

Create `src/client/src/app/core/services/dashboard.service.spec.ts` (or extend if it exists) to assert the mapper threads the fields. First read `dashboard.service.ts` to confirm whether `mapDashboardCompanies` is exported; if not, export it for testability.

```typescript
import { describe, it, expect } from 'vitest';
import { mapDashboardCompanies } from './dashboard.service';

describe('mapDashboardCompanies PI presence', () => {
  it('threads has_intelligence and intelligence_headline onto trials', () => {
    const raw = [
      {
        id: 'co1', name: 'Co', logo_url: null,
        assets: [
          {
            id: 'a1', name: 'Asset', logo_url: null, moas: [], roas: [], indications: [],
            trials: [
              {
                id: 't1', name: 'Trial', acronym: null, identifier: null, status: 'active',
                markers: [], trial_notes: [],
                has_intelligence: true, intelligence_headline: 'Lead extends edge',
              },
            ],
          },
        ],
      },
    ];
    const companies = mapDashboardCompanies(raw as never);
    const trial = companies[0].assets[0].trials[0];
    expect(trial.has_intelligence).toBe(true);
    expect(trial.intelligence_headline).toBe('Lead extends edge');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- dashboard.service`
Expected: FAIL (fields undefined, or `mapDashboardCompanies` not exported).

- [ ] **Step 4: Wire the mappers**

In `dashboard.service.ts` `mapDashboardCompanies` (the trial mapping around lines 71-119), add the two fields where the trial object is built:

```typescript
        has_intelligence: rawTrial.has_intelligence ?? false,
        intelligence_headline: rawTrial.intelligence_headline ?? null,
```

In `landscape.service.ts` `getHeatmapData`: verify the raw payload is spread into bubbles/products (the report shows `const raw = data as ...; return { ...raw, ... }`). If products/bubbles are mapped field-by-field anywhere, add `has_intelligence: p.has_intelligence ?? false` and `intelligence_count: b.intelligence_count ?? 0`. If it is a straight pass-through cast, the fields flow through automatically; the type additions in Step 1 make them visible. Add a one-line normalization to guarantee defaults if the mapping is explicit.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- dashboard.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/models/trial.model.ts src/client/src/app/core/models/landscape.model.ts src/client/src/app/core/services/dashboard.service.ts src/client/src/app/core/services/landscape.service.ts src/client/src/app/core/services/dashboard.service.spec.ts
git commit -m "feat(landscape): thread primary-intelligence presence fields through models and mappers"
```

---

## Task 5: Service - marker references via `list_primary_intelligence`

**Files:**
- Modify: `src/client/src/app/core/services/primary-intelligence.service.ts`
- Modify: `src/client/src/app/core/models/primary-intelligence.model.ts` (referencing type already widened by `PiReference`; here widen the `list()` param)
- Test: `src/client/src/app/core/services/primary-intelligence.service.spec.ts` (create or extend)

**Interfaces:**
- Consumes: existing `list()` and `IntelligenceFeedRow`; `PiReference` (Task 2).
- Produces:
  - `list()` `referencingEntityType` param type widened to `IntelligenceEntityType | IntelligenceLinkEntityType | null` (so `'marker'` is allowed).
  - `getMarkerReferences(spaceId: string, markerId: string): Promise<PiReference[]>` - calls `list({ spaceId, referencingEntityType: 'marker', referencingEntityId: markerId, entityTypes: ['trial','company','product'] })` and maps `rows` to `PiReference` (`{ id, entity_type, entity_name: null, headline }`; owner names are not resolved by the RPC, so `entity_name` is null).

- [ ] **Step 1: Write the failing test**

Create/extend `src/client/src/app/core/services/primary-intelligence.service.spec.ts`. Mock `SupabaseService.client.rpc` to capture params and return a feed result.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PrimaryIntelligenceService } from './primary-intelligence.service';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

describe('PrimaryIntelligenceService.getMarkerReferences', () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn().mockReturnValue({
      throwOnError: () =>
        Promise.resolve({
          data: {
            rows: [
              { id: 'pi1', entity_type: 'trial', entity_id: 't1', headline: 'Cites this catalyst', state: 'published', summary_md: '', last_edited_by: 'u', updated_at: 'now', links: [], contributors: [] },
            ],
            total: 1, limit: 50, offset: 0,
          },
        }),
    });
    TestBed.configureTestingModule({
      providers: [
        PrimaryIntelligenceService,
        { provide: SupabaseService, useValue: { client: { rpc } } },
        { provide: RpcCache, useValue: { get: (_k: string, _p: unknown, o: { fetch: () => unknown }) => o.fetch() } },
      ],
    });
  });

  it('queries list_primary_intelligence with marker referencing params and maps to PiReference', async () => {
    const svc = TestBed.inject(PrimaryIntelligenceService);
    const refs = await svc.getMarkerReferences('space1', 'marker1');
    expect(rpc).toHaveBeenCalledWith(
      'list_primary_intelligence',
      expect.objectContaining({
        p_space_id: 'space1',
        p_referencing_entity_type: 'marker',
        p_referencing_entity_id: 'marker1',
      })
    );
    expect(refs).toEqual([
      { id: 'pi1', entity_type: 'trial', entity_id: 't1', entity_name: null, headline: 'Cites this catalyst' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- primary-intelligence.service`
Expected: FAIL (`getMarkerReferences` not a function).

- [ ] **Step 3: Implement**

In `primary-intelligence.service.ts`:
- Add `IntelligenceLinkEntityType` and `PiReference` to the model import.
- Widen the `list()` opts type: `referencingEntityType?: IntelligenceEntityType | IntelligenceLinkEntityType | null;`.
- Add the method:

```typescript
  async getMarkerReferences(spaceId: string, markerId: string): Promise<PiReference[]> {
    const result = await this.list({
      spaceId,
      entityTypes: ['trial', 'company', 'product'],
      referencingEntityType: 'marker',
      referencingEntityId: markerId,
      limit: 50,
    });
    return result.rows.map((r) => ({
      id: r.id,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      entity_name: null,
      headline: r.headline,
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- primary-intelligence.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/primary-intelligence.service.ts
git commit -m "feat(landscape): add getMarkerReferences for incoming PI references"
```

---

## Task 6: Timeline - trial-row bookmark mark + headline + density toggle

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts` / `.html`
- Modify: `src/client/src/app/features/landscape/timeline-view.component.ts` / `.html`
- Test: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.spec.ts` (create or extend)

**Interfaces:**
- Consumes: `PiMarkComponent` (Task 1); `Trial.has_intelligence` / `Trial.intelligence_headline` (Task 4).
- Produces:
  - `DashboardGridComponent` new input `showIntelligenceHeadlines = input<boolean>(true)`.
  - Trial column renders `<app-pi-mark>` beside the trial name when `row.trial.has_intelligence`, and (when `showIntelligenceHeadlines()`) the `intelligence_headline` as a truncated second line.
  - `timeline-view` owns a persisted `showIntelligenceHeadlines` signal (localStorage key `clint:pi-headlines:<spaceId>`, default `true`) with a toggle control, passed into the grid.

- [ ] **Step 1: Write the failing test**

In `dashboard-grid.component.spec.ts`, render a grid with one trial that has PI and assert the mark + headline appear, and that toggling the input hides the headline (but not the mark). Read the existing spec (if any) for the harness/fixture setup pattern and reuse it. Minimal assertion shape:

```typescript
it('shows the PI mark and headline for a trial with intelligence', () => {
  // ...arrange fixture with a FlattenedTrial whose trial.has_intelligence = true,
  // trial.intelligence_headline = 'Lead extends edge', and showIntelligenceHeadlines = true
  fixture.detectChanges();
  const host: HTMLElement = fixture.nativeElement;
  expect(host.querySelector('app-pi-mark')).toBeTruthy();
  expect(host.textContent).toContain('Lead extends edge');
});

it('hides the headline but keeps the mark when headlines are off', () => {
  fixture.componentRef.setInput('showIntelligenceHeadlines', false);
  fixture.detectChanges();
  const host: HTMLElement = fixture.nativeElement;
  expect(host.querySelector('app-pi-mark')).toBeTruthy();
  expect(host.textContent).not.toContain('Lead extends edge');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- dashboard-grid`
Expected: FAIL.

- [ ] **Step 3: Implement grid changes**

In `dashboard-grid.component.ts`: import `PiMarkComponent`, add it to `imports`, and add `readonly showIntelligenceHeadlines = input<boolean>(true);`.

In `dashboard-grid.component.html`, the trial column (around lines 262-297). Restructure so the name + mark sit on a first line and the headline (optional) on a second. The column is currently a single flex-center row; wrap its text content in a `flex-col`:

```html
<div class="flex min-w-0 flex-col justify-center">
  <span class="flex min-w-0 items-center gap-1">
    @if (row.trial.ctgov_withdrawn_at) {
      <i class="fa-solid fa-ban text-[9px] text-amber-700 shrink-0" aria-hidden="true"></i>
    }
    <span class="truncate">{{ row.trial.acronym ?? row.trial.name }}</span>
    @if (row.trial.has_intelligence) {
      <app-pi-mark [size]="11" class="shrink-0" />
    }
    <app-change-badge
      class="inline-flex items-center"
      [count]="row.trial.recent_changes_count ?? 0"
      [type]="row.trial.most_recent_change_type ?? null"
      [eventId]="row.trial.most_recent_change_event_id ?? null"
    />
    @if (row.trial.identifier) {
      <span class="text-[10px] text-slate-400 font-mono">{{ row.trial.identifier }}</span>
    }
  </span>
  @if (showIntelligenceHeadlines() && row.trial.has_intelligence && row.trial.intelligence_headline) {
    <span class="flex min-w-0 items-center gap-1 text-[10px] leading-tight text-brand-700">
      <app-pi-mark [size]="9" class="shrink-0" />
      <span class="truncate">{{ row.trial.intelligence_headline }}</span>
    </span>
  }
</div>
```

Keep the outer clickable `<div>` (role/button/keydown/`onTrialClick`) wrapping this. Ensure the outer div keeps `items-center` removed if it now contains a column; adjust to `flex items-stretch`. The horizontal time axis is unaffected (only the trial rail column changes height). Do not let the second line shift marker positions: the row height grows but marker `cx` positions are time-based, unaffected.

- [ ] **Step 4: Implement timeline-view toggle + persistence**

In `timeline-view.component.ts`:
- Add a persisted signal:

```typescript
  private readonly headlinesKey = computed(() => `clint:pi-headlines:${this.spaceId()}`);
  readonly showIntelligenceHeadlines = signal<boolean>(true);

  // in constructor / ngOnInit after spaceId resolves:
  //   const stored = localStorage.getItem(this.headlinesKey());
  //   if (stored !== null) this.showIntelligenceHeadlines.set(stored === 'true');

  toggleIntelligenceHeadlines(): void {
    const next = !this.showIntelligenceHeadlines();
    this.showIntelligenceHeadlines.set(next);
    try { localStorage.setItem(this.headlinesKey(), String(next)); } catch { /* ignore */ }
  }
```

(Use an `effect` reading `headlinesKey()` to hydrate once `spaceId` is available; guard against SSR-less but missing `localStorage` with try/catch. Follow the existing reactivity idiom in the file.)

- In `timeline-view.component.html`, pass the input into `<app-dashboard-grid ... [showIntelligenceHeadlines]="showIntelligenceHeadlines()" ...>` and add a small toggle control near the existing grid toolbar/insight strip. Use an uppercase-tracked text affordance consistent with the surface (not a CTA button):

```html
<button
  type="button"
  class="text-[10px] font-medium uppercase tracking-wider text-slate-500 hover:text-brand-700"
  [attr.aria-pressed]="showIntelligenceHeadlines()"
  (click)="toggleIntelligenceHeadlines()"
>
  Intelligence headlines: {{ showIntelligenceHeadlines() ? 'On' : 'Off' }}
</button>
```

Place it where the timeline view already hosts view controls (read the template to find the controls row; if none, place it above the grid).

- [ ] **Step 5: Run tests + lint**

Run: `cd src/client && npm run test:units -- dashboard-grid && ng lint`
Expected: PASS / no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/ src/client/src/app/features/landscape/timeline-view.component.*
git commit -m "feat(timeline): add PI bookmark mark and toggleable headline to trial rows"
```

---

## Task 7: Timeline - marker references in tooltip + marker detail pane

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-state.service.ts`
- Modify: `src/client/src/app/features/dashboard/grid/marker.component.ts` / `.html`
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html` (pass headline to marker)
- Modify: `src/client/src/app/shared/components/marker-detail-content.component.ts`
- Modify: `src/client/src/app/shared/components/marker-detail-panel.component.ts` (pass references through)
- Modify: `src/client/src/app/features/landscape/landscape-shell.component.ts` (bind references input)
- Test: `landscape-state.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `getMarkerReferences` (Task 5); `PiDetailSectionComponent` (Task 2).
- Produces:
  - `LandscapeStateService` signal `selectedMarkerReferences = signal<PiReference[]>([])`, populated in `fetchAndSet` via a second call to `getMarkerReferences(spaceId, markerId)` (guarded by the same `selectedMarkerId` race check), cleared in `clearSelection`.
  - `MarkerTooltipComponent.intelligenceHeadline` populated when a marker has references (pass the first reference's headline, or a count). Decision: pass a short count string is not enough for the tooltip's existing single-headline slot, so pass the top reference headline; the full counted list lives in the pane.
  - `MarkerDetailContentComponent` new input `references = input<PiReference[]>([])`, rendered via `<app-pi-detail-section>` with `countLabel = "Referenced in N intelligence entries"`.

- [ ] **Step 1: Write the failing test (state service)**

In `landscape-state.service.spec.ts`, extend to assert that selecting a marker populates `selectedMarkerReferences`. Mock the catalyst service and the intelligence service. Read the existing spec to match its mocking style; assert:

```typescript
it('loads marker references on marker selection', async () => {
  // arrange: catalyst.getCatalystDetail resolves a detail; intelligence.getMarkerReferences resolves [ref]
  await service.selectMarker('m1');
  expect(service.selectedMarkerReferences()).toEqual([
    { id: 'pi1', entity_type: 'trial', entity_id: 't1', entity_name: null, headline: 'Cites this catalyst' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- landscape-state`
Expected: FAIL.

- [ ] **Step 3: Implement state service**

In `landscape-state.service.ts`:
- Inject `PrimaryIntelligenceService`.
- Add `readonly selectedMarkerReferences = signal<PiReference[]>([]);`.
- In `fetchAndSet`, after setting `selectedDetail`, also load references (do not block the catalyst detail render; fetch in parallel and apply with the race guard):

```typescript
    this.selectedMarkerReferences.set([]);
    const spaceId = this.spaceIdSig();
    if (spaceId) {
      void this.intelligence
        .getMarkerReferences(spaceId, markerId)
        .then((refs) => {
          if (this.selectedMarkerId() === markerId) this.selectedMarkerReferences.set(refs);
        })
        .catch(() => { /* references are non-critical */ });
    }
```

- In `clearSelection`, add `this.selectedMarkerReferences.set([]);`.

- [ ] **Step 4: Wire the marker detail pane**

In `marker-detail-content.component.ts`: import `PiDetailSectionComponent`, add to imports, add `readonly references = input<PiReference[]>([]);` and a computed count label:

```typescript
  protected readonly referenceCountLabel = computed(() => {
    const n = this.references().length;
    return n > 0 ? `Referenced in ${n} intelligence ${n === 1 ? 'entry' : 'entries'}` : null;
  });
```

Insert a new section after the source-provenance section (around line 294, before "Upcoming for this trial"), matching the existing `detail-panel-section` pattern:

```html
@if (references().length > 0) {
  <app-detail-panel-section label="Referenced in intelligence">
    <app-pi-detail-section
      [references]="references()"
      [countLabel]="referenceCountLabel()"
      (referenceClick)="onReferenceClick($event)"
    />
  </app-detail-panel-section>
}
```

Add `onReferenceClick(ref: PiReference)` that emits an existing output or navigates (reuse the pattern the bullseye uses). If no such output exists on this component, add `readonly openIntelligence = output<{ entityType: string; entityId: string }>();` and emit `{ entityType: ref.entity_type, entityId: ref.entity_id }` (the owner entity, not the PI row id — `PiReference.entity_id` carries the owner id from Task 2). The landscape-shell host then routes this to `state.selectTrial(...)` for trial owners, or navigates to the asset/company manage page, mirroring the bullseye behavior.

- [ ] **Step 5: Thread references + headline through the panel and grid**

- `marker-detail-panel.component.ts`: add `readonly references = input<PiReference[]>([]);` and bind it onto `<app-marker-detail-content [references]="references()">`.
- `landscape-shell.component.ts`: bind `[references]="state.selectedMarkerReferences()"` on `<app-marker-detail-panel>`.
- `marker.component.ts` + `.html`: add `readonly intelligenceHeadline = input<string | null>(null);` and pass `[intelligenceHeadline]="intelligenceHeadline()"` to `<app-marker-tooltip>`.
- `dashboard-grid.component.html`: where markers are rendered (the `<app-marker>` host), pass `[intelligenceHeadline]="..."`. The grid does not have per-marker reference data loaded; the tooltip headline for a marker should reflect that the marker is referenced. Since presence-per-marker is not in the read-path extension (Task 3 only covers trial/asset), **scope the tooltip headline to null for v1** and rely on the detail pane for marker references. (Document this: the unused `intelligenceHeadline` input stays wired but is fed null until a per-marker presence flag exists. This keeps the tooltip lean per its own doc comment.) Remove this sub-step's tooltip-population ambiguity by NOT populating the tooltip headline from marker refs in v1.

- [ ] **Step 6: Run tests + lint**

Run: `cd src/client && npm run test:units -- landscape-state && ng lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-state.service.* src/client/src/app/features/landscape/landscape-shell.component.ts src/client/src/app/shared/components/marker-detail-content.component.ts src/client/src/app/shared/components/marker-detail-panel.component.ts src/client/src/app/features/dashboard/grid/marker.component.* src/client/src/app/core/services/primary-intelligence.service.ts src/client/src/app/core/models/primary-intelligence.model.ts
git commit -m "feat(timeline): surface incoming PI references in the marker detail pane"
```

---

## Task 8: Timeline - trial-row click opens trial PI pane (landscape only)

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-state.service.ts`
- Modify: `src/client/src/app/features/landscape/timeline-view.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-shell.component.ts`
- Create: `src/client/src/app/features/landscape/trial-detail-panel.component.ts` (thin pane reusing `detail-panel-shell` + `PiDetailSection`)
- Test: `landscape-state.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `getTrialDetail` (existing service -> `get_trial_detail_with_intelligence`); `IntelligenceDetailBundle`; `PiDetailSectionComponent`.
- Produces:
  - `LandscapeStateService`: `selectedTrialId = signal<string | null>(null)`, `selectedTrialDetail = signal<IntelligenceDetailBundle | null>(null)`, `selectTrial(trialId)`, with `clearSelection()` clearing trial state too and the marker/trial selections mutually exclusive (selecting one clears the other).
  - `TrialDetailPanelComponent` (selector `app-trial-detail-panel`): inputs `detail`, `open`; output `panelClose`; renders `PiDetailSection` from `detail.published?.record` (headline + `summary_md`).

- [ ] **Step 1: Write the failing test**

In `landscape-state.service.spec.ts`:

```typescript
it('selectTrial loads trial PI detail and clears marker selection', async () => {
  await service.selectMarker('m1');
  await service.selectTrial('t1');
  expect(service.selectedTrialId()).toBe('t1');
  expect(service.selectedMarkerId()).toBeNull();
  expect(service.selectedTrialDetail()?.entity_id).toBe('t1');
});
```

Mock `PrimaryIntelligenceService.getTrialDetail` to resolve a bundle `{ entity_id: 't1', entity_type: 'trial', published: { record: { headline: 'H', summary_md: 'S' } }, draft: null, referenced_in: [], space_id: 's' }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- landscape-state`
Expected: FAIL (`selectTrial` not a function).

- [ ] **Step 3: Implement state service**

```typescript
  readonly selectedTrialId = signal<string | null>(null);
  readonly selectedTrialDetail = signal<IntelligenceDetailBundle | null>(null);

  async selectTrial(trialId: string): Promise<void> {
    this.clearSelection();            // clears marker + references
    this.selectedTrialId.set(trialId);
    this.detailLoading.set(true);
    try {
      const detail = await this.intelligence.getTrialDetail(trialId);
      if (this.selectedTrialId() === trialId) this.selectedTrialDetail.set(detail);
    } catch {
      this.selectedTrialId.set(null);
    } finally {
      this.detailLoading.set(false);
    }
  }
```

Update `clearSelection()` to also reset `selectedTrialId` and `selectedTrialDetail`. Update `selectMarker`/`fetchAndSet` to clear `selectedTrialId`/`selectedTrialDetail` so the two panes are mutually exclusive.

- [ ] **Step 4: Create the trial detail panel**

Create `src/client/src/app/features/landscape/trial-detail-panel.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { PiDetailSectionComponent } from '../../shared/components/pi-detail-section/pi-detail-section.component';
import { IntelligenceDetailBundle } from '../../core/models/primary-intelligence.model';

@Component({
  selector: 'app-trial-detail-panel',
  standalone: true,
  imports: [DetailPanelShellComponent, DetailPanelSectionComponent, PiDetailSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-detail-panel-shell [label]="record()?.headline ?? 'Trial intelligence'" [open]="open()" (panelClose)="panelClose.emit()">
      @if (record(); as r) {
        <app-detail-panel-section [first]="true">
          <app-pi-detail-section [headline]="r.headline" [summary]="r.summary_md" />
        </app-detail-panel-section>
      } @else {
        <app-detail-panel-section [first]="true">
          <p class="text-[12px] text-slate-500">No published intelligence for this trial yet.</p>
        </app-detail-panel-section>
      }
    </app-detail-panel-shell>
  `,
})
export class TrialDetailPanelComponent {
  readonly detail = input<IntelligenceDetailBundle | null>(null);
  readonly open = input<boolean>(false);
  readonly panelClose = output<void>();
  protected readonly record = computed(() => this.detail()?.published?.record ?? null);
}
```

(Verify `DetailPanelShellComponent`'s input names — `label`, `open`, `panelClose` — against `detail-panel-shell.component.ts`; adjust to match. Read it first.)

- [ ] **Step 5: Wire landscape-shell + timeline-view**

- `timeline-view.component.ts` `onTrialClick`: replace the `router.navigate([... 'manage','trials', trial.id])` body with `void this.state.selectTrial(trial.id);`. (This changes only the landscape timeline host; events page / drawer keep their navigation.)
- `landscape-shell.component.ts`: add a sibling branch to the marker pane:

```html
@if (state.selectedTrialId()) {
  <app-trial-detail-panel
    [detail]="state.selectedTrialDetail()"
    [open]="!!state.selectedTrialId()"
    (panelClose)="state.clearSelection()"
  />
}
```

Import `TrialDetailPanelComponent`.

- [ ] **Step 6: Run tests + lint**

Run: `cd src/client && npm run test:units -- landscape-state && ng lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-state.service.* src/client/src/app/features/landscape/timeline-view.component.ts src/client/src/app/features/landscape/landscape-shell.component.ts src/client/src/app/features/landscape/trial-detail-panel.component.ts
git commit -m "feat(timeline): open trial primary intelligence in the detail pane on row click"
```

---

## Task 9: Bullseye - replace blue halo with brand bookmark badge

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-signal-mark.component.ts`
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.ts` / `.html`
- Test: `src/client/src/app/features/landscape/bullseye-chart.component.spec.ts` (create or extend) and/or `bullseye-signal-mark.component.spec.ts`

**Interfaces:**
- Consumes: `BOOKMARK_PATH`, `PI_MARK_VIEWBOX` (Task 1); `BullseyeAsset.intelligence_count` (existing).
- Produces:
  - `bullseye-signal-mark` no longer renders the blue (`#2563eb`) intelligence ring (remove from `rings()` and the `hasIntelligence` input usage; keep the input or remove it - if no other consumer reads it, remove it and update call sites).
  - `bullseye-chart` renders the bookmark glyph (using `BOOKMARK_PATH` inline in the SVG) at the node corner when `dot.product.intelligence_count > 0`, with `fill="var(--brand-600)"`, white stroke, `aria-label="Has primary intelligence"`. The orange activity pulse ring (`#f97316`, `.activity-pulse`) is unchanged.

- [ ] **Step 1: Write the failing test**

In `bullseye-chart.component.spec.ts`, assert that a node with `intelligence_count > 0` renders a bookmark `<path>` with the shared `d` and `var(--brand-600)` fill, and NO `circle.halo-ring` with `stroke="#2563eb"`. Read the existing bullseye spec harness (there are several `*.spec.ts` in the folder) and reuse the fixture pattern.

```typescript
import { BOOKMARK_PATH } from '../../shared/components/pi-mark/pi-mark.component';
// ...
it('renders the brand bookmark badge and no blue halo for a node with intelligence', () => {
  // arrange a dot whose product.intelligence_count = 1
  fixture.detectChanges();
  const svg: SVGElement = fixture.nativeElement.querySelector('svg');
  expect(svg.querySelector('circle.halo-ring')).toBeNull();
  const path = Array.from(svg.querySelectorAll('path')).find(
    (p) => p.getAttribute('d') === BOOKMARK_PATH
  );
  expect(path).toBeTruthy();
  expect(path!.getAttribute('fill')).toBe('var(--brand-600)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- bullseye-chart`
Expected: FAIL (halo-ring still present / bookmark absent).

- [ ] **Step 3: Remove the blue intel ring from signal-mark**

In `bullseye-signal-mark.component.ts` `rings()` computed (lines 67-95), delete the `if (this.hasIntelligence()) { rings.push({ kind: 'intel', stroke: '#2563eb', ... }); r += step; }` block. If `hasIntelligence` input is now unused, remove the input and remove `[hasIntelligence]` bindings at its three call sites (chart dot, `bullseye-tooltip.component.ts`, `bullseye-detail-panel.component.html`). Run `ng lint` to catch orphaned bindings.

- [ ] **Step 4: Add the bookmark badge in the chart**

In `bullseye-chart.component.html`, remove the `@if (dot.product.intelligence_count > 0) { <circle ... class="halo-ring" /> }` block (lines 114-125). Add a bookmark glyph at the node corner. Define `protected readonly bookmarkPath = BOOKMARK_PATH;` in the component. Place a group offset to the top-right of the dot (the dot radius is ~ from geometry; offset by +7,-13 so the bookmark sits at the corner). Render the shared path scaled into ~11px:

```html
@if (dot.product.intelligence_count > 0) {
  <g
    role="img"
    aria-label="Has primary intelligence"
    [attr.transform]="'translate(' + (dot.x + 5) + ',' + (dot.y - 13) + ') scale(' + (11/24) + ')'"
    style="pointer-events: none;"
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
```

Remove the now-unused `.halo-ring` style from `bullseye-chart.component.ts`. Keep `.activity-pulse` intact. (Tune the translate offset visually during verification; the corner placement should not overlap the phase dot fill.)

- [ ] **Step 5: Run test + lint**

Run: `cd src/client && npm run test:units -- bullseye-chart bullseye-signal-mark && ng lint`
Expected: PASS / no orphaned-binding lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-signal-mark.component.ts src/client/src/app/features/landscape/bullseye-chart.component.* src/client/src/app/features/landscape/bullseye-tooltip.component.ts src/client/src/app/features/landscape/bullseye-detail-panel.component.html
git commit -m "feat(bullseye): replace blue intelligence halo with brand bookmark badge"
```

---

## Task 10: Bullseye - detail panel intelligence section via PiDetailSection

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts` / `.html`
- Test: extend `bullseye-detail-panel` coverage if a spec exists; otherwise rely on a focused render test.

**Interfaces:**
- Consumes: `PiDetailSectionComponent`; existing `intelligenceNotes` signal (`AssetIntelligenceNote[]`) and `asset.intelligence_count`.
- Produces: the existing "Intelligence (N)" section maps each `AssetIntelligenceNote` to a `PiReference` (`{ id, entity_type: note.entity_type, entity_id: note.entity_id, entity_name: note.entity_name, headline: note.headline }`) and renders `<app-pi-detail-section [references]="..." [countLabel]="..." (referenceClick)="onIntelligenceClick($event)">`, replacing the hand-rolled entity-list markup (lines 199-227).

- [ ] **Step 1: Write/extend the failing test**

Assert that when `intelligenceNotes()` has entries, an `app-pi-detail-section` renders with the notes mapped to references and the count label `"N of M ..."` is not used here (this is the asset-owned list, so use `"Intelligence (N)"` as the section label and no `countLabel`, OR a `countLabel` of `Referenced in N intelligence entries`). Decision: keep the existing section label `Intelligence (N)` on the `detail-panel-section` wrapper and pass no `countLabel`; PiDetailSection just renders the reference rows. Assert `app-pi-detail-section` present and contains a note headline.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- bullseye-detail-panel`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `bullseye-detail-panel.component.ts`: import `PiDetailSectionComponent` and `PiReference`; add a computed:

```typescript
  protected readonly intelligenceReferences = computed<PiReference[]>(() =>
    this.intelligenceNotes().map((n) => ({
      id: n.id,
      entity_type: n.entity_type,
      entity_id: n.entity_id,
      entity_name: n.entity_name,
      headline: n.headline,
    }))
  );
```

In `.html`, replace the inner entity-list block (lines 199-227, inside the `@if (asset.intelligence_count > 0)` section) with:

```html
<app-pi-detail-section
  [references]="intelligenceReferences()"
  (referenceClick)="onIntelligenceClick($event)"
/>
```

Update `onIntelligenceClick` to accept a `PiReference` and emit `{ entityType: ref.entity_type, entityId: ref.entity_id }` (same as before, since `PiReference` now carries `entity_id`). Keep the loading skeleton branch.

- [ ] **Step 4: Run test + lint**

Run: `cd src/client && npm run test:units -- bullseye-detail-panel && ng lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-detail-panel.component.*
git commit -m "feat(bullseye): render intelligence section via shared PiDetailSection"
```

---

## Task 11: Heatmap - cell brand bookmark flag

**Files:**
- Modify: `src/client/src/app/features/landscape/heatmap.component.ts`
- Test: `src/client/src/app/features/landscape/heatmap.component.spec.ts` (extend)

**Interfaces:**
- Consumes: `HeatmapAsset.has_intelligence`, `HeatmapBubble.intelligence_count` (Task 4); `BOOKMARK_PATH` / `PiMarkComponent` (Task 1).
- Produces: each `MatrixCell` gains `hasIntelligence: boolean` (true when any asset in the bubble at that cell's phase has PI); the cell renders a small brand bookmark flag in the corner when true. The cell is HTML (`.heat-pip` div), so use `PiMarkComponent` (HTML svg).

- [ ] **Step 1: Write the failing test**

In `heatmap.component.spec.ts`, build a bubble whose products include one with `has_intelligence: true` at a given phase, assert the matrix row's cell for that phase has `hasIntelligence === true` and the template renders an `app-pi-mark` inside that cell. Reuse the existing heatmap spec fixture pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- heatmap.component`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `heatmap.component.ts`:
- Extend `MatrixCell` (lines 49-54): add `hasIntelligence: boolean;`.
- Where cells are computed from the bubble (around line 426, `phase_counts[phase]`), set `hasIntelligence` by checking whether any product in the bubble at that phase has PI:

```typescript
const hasIntelligence = bubble.products.some(
  (p) => p.highest_phase === phase && p.has_intelligence
);
```

- Import `PiMarkComponent`, add to imports.
- In the cell template (lines 374-390), inside the non-empty `.heat-pip` branch, add a corner flag (absolute positioned). Wrap `.heat-pip` as `relative`:

```html
<div class="heat-pip relative" [style.background-color]="cell.background">
  {{ cell.count }}
  @if (cell.hasIntelligence) {
    <app-pi-mark [size]="9" class="absolute right-0.5 top-0.5" />
  }
</div>
```

The white outline keeps the mark visible on any phase tint (including same-hue teal P3).

- [ ] **Step 4: Run test + lint**

Run: `cd src/client && npm run test:units -- heatmap.component && ng lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/heatmap.component.ts
git commit -m "feat(heatmap): add brand bookmark flag to cells with primary intelligence"
```

---

## Task 12: Heatmap - detail panel intelligence section

**Files:**
- Modify: `src/client/src/app/features/landscape/heatmap-detail-panel.component.ts`
- Test: `src/client/src/app/features/landscape/heatmap-detail-panel.component.spec.ts` (create or extend)

**Interfaces:**
- Consumes: `HeatmapBubble.products` (each with `has_intelligence`, `name`, `id`), `HeatmapBubble.intelligence_count`; `PiDetailSectionComponent`; `PiReference`.
- Produces: a new `detail-panel-section` titled "Primary intelligence" showing `"N of M assets have intelligence"` and a reference list of the PI-bearing assets (mark + asset name + ... ). Maps PI-bearing products to `PiReference` (`{ id: p.id, entity_type: 'product', entity_id: p.id, entity_name: p.name, headline: p.name }` - headline falls back to the asset name since the bubble payload carries no PI headline; the count line is the primary signal). Clicking a reference emits the existing `openIntelligence`/navigation output the panel already uses, or navigates to the asset.

- [ ] **Step 1: Write the failing test**

Assert: given a bubble with 5 products, 2 with `has_intelligence`, the panel renders `app-pi-detail-section` with countLabel containing `2 of 5 assets have intelligence` and 2 reference rows.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- heatmap-detail-panel`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `heatmap-detail-panel.component.ts`: import `PiDetailSectionComponent`, `DetailPanelSectionComponent` (already used), `PiReference`. Add computeds:

```typescript
  protected readonly piReferences = computed<PiReference[]>(() =>
    (this.bubble()?.products ?? [])
      .filter((p) => p.has_intelligence)
      .map((p) => ({ id: p.id, entity_type: 'product' as const, entity_id: p.id, entity_name: p.name, headline: p.name }))
  );
  protected readonly piCountLabel = computed(() => {
    const b = this.bubble();
    if (!b) return null;
    const m = b.products.length;
    const n = b.intelligence_count ?? this.piReferences().length;
    return n > 0 ? `${n} of ${m} assets have intelligence` : null;
  });
```

Add the section after "Competitive phase progress" (around line 124, before the footer):

```html
@if (piReferences().length > 0) {
  <app-detail-panel-section label="Primary intelligence">
    <app-pi-detail-section
      [references]="piReferences()"
      [countLabel]="piCountLabel()"
      (referenceClick)="onPiReferenceClick($event)"
    />
  </app-detail-panel-section>
}
```

Add `onPiReferenceClick(ref: PiReference)` to emit the panel's existing intelligence/navigation output (read the component for the existing `openIntelligence`/`assetClick` output; reuse it, emitting `{ entityType: 'product', entityId: ref.entity_id }`).

- [ ] **Step 4: Run test + lint**

Run: `cd src/client && npm run test:units -- heatmap-detail-panel && ng lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/heatmap-detail-panel.component.ts
git commit -m "feat(heatmap): add primary intelligence section to the detail panel"
```

---

## Task 13: Full verification + docs + finish

**Files:** none (verification only), plus any doc/help touch-ups surfaced by the stop-hook.

- [ ] **Step 1: Full unit suite**

Run: `cd src/client && npm run test:units`
Expected: PASS (all specs, including the new PI specs).

- [ ] **Step 2: Lint + build**

Run: `cd src/client && ng lint && ng build`
Expected: lint clean; build succeeds.

- [ ] **Step 3: Re-confirm migration advisors + docs regen are committed**

```bash
git status --short
```

Expected: no stray uncommitted changes under `docs/runbook/` from Task 3. If `npm run docs:arch` produced further drift after later tasks (it should not, since no routes/migrations changed after Task 3), re-run and commit.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Per the `verify` skill / `reference_playwright_local_auth_export_verify` memory, load the landscape surfaces on a tenant brand (use `?wl_kind=tenant&wl_id=<uuid>`), confirm: (a) trial rows show the bookmark + headline and the toggle hides headlines; (b) bullseye nodes show the bookmark badge (no blue halo) and activity pulse still pulses; (c) heatmap cells show the corner flag; (d) each detail pane renders the shared PI block / reference list with the right count. Test once on the worst-case orange brand to confirm the white outline holds.

- [ ] **Step 5: Merge develop, resolve conflicts, open PR**

```bash
git fetch origin && git merge origin/develop
# resolve any conflicts, re-run: cd src/client && npm run test:units && ng build
git push -u origin feat/pi-landscape-surfaces
gh pr create --base develop --title "feat: primary intelligence across landscape surfaces" --body "<summary + test evidence>"
```

(Do not use `gh pr merge --auto`; per project memory, develop merges trigger the dev deploy.)

---

## Self-Review

**Spec coverage:**
- Presence mark (bookmark, brand fill, white outline, static, ~9-11px): Task 1 (`PiMark` + `BOOKMARK_PATH`). Used on timeline (Task 6), bullseye (Task 9), heatmap (Task 11).
- Shared detail-pane component (PI block + reference list + count): Task 2 (`PiDetailSection`), used in Tasks 7, 8, 10, 12.
- Owner vs reference split: trial/asset own (Tasks 6, 8, 10, 11, 12); marker references (Task 7). Covered.
- Whitelabel color rule: all PI chrome uses `--brand-*` / `bg-brand-*` (Tasks 1, 2, 6, 9, 11); data colors stay hardcoded (activity orange untouched in Task 9). Covered.
- Activity stays hollow pulsing ring, PI static: Task 9 keeps `.activity-pulse`, removes only the blue halo. Covered.
- Bullseye blue halo replaced (not kept): Task 9. Covered.
- Heatmap in scope (cell + panel): Tasks 11, 12. Covered.
- Data-layer extensions (timeline presence+headline, heatmap presence): Task 3 (RPCs) + Task 4 (models/mappers). Marker refs on selection: Task 7. Covered.
- Accessibility (not color-only, aria-label, white outline contrast, distinct from activity, focusable references): Tasks 1, 2 (aria-label, focusable rows), 9 (aria-label on SVG badge). Covered.
- Timeline headline density toggle (default on, persisted per user): Task 6 (localStorage per user/space). Covered (note: client-side persistence chosen since no server per-user settings store exists; flagged in Task 6).

**Placeholder scan:** No "TBD"/"add error handling" placeholders; each code step shows code. Two spots intentionally instruct the executor to read a host file first (detail-panel-shell input names in Task 8; current RPC bodies in Task 3) because those must be copied verbatim from live state per the `CREATE OR REPLACE stale-base clobber` memory - this is a correctness guard, not a placeholder.

**Type consistency:** `PiReference` is `{ id, entity_type, entity_id, entity_name, headline }`, defined whole in Task 2 and used unchanged in Tasks 5, 7, 8, 10, 12 (all mappers populate `entity_id`). `has_intelligence` (boolean) and `intelligence_headline` (string|null) names match across Task 3 RPC keys and Task 4 model fields. `intelligence_count` (number) consistent on `HeatmapBubble` across Tasks 3, 4, 12. `showIntelligenceHeadlines` input name consistent across Task 6 grid + timeline-view.
