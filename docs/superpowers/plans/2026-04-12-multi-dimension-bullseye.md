# Multi-Dimension Bullseye Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the landscape bullseye chart so it can be scoped to any of four dimensions (Therapeutic Area, Company, MOA, ROA) with a sidebar for dimension navigation and a spoke toggle for grouped vs. flat product views.

**Architecture:** Refactor the existing bullseye components to accept generalized `BullseyeSpoke[]` instead of hardcoded `BullseyeCompany[]`. Add a `LandscapeShellComponent` with a sidebar for dimension navigation. Create new Supabase RPC functions for each dimension. Route structure changes from `/landscape/:taId` to `/landscape/by-{dimension}/:entityId`.

**Tech Stack:** Angular 19 (standalone components, signals), PrimeNG 19, Tailwind CSS v4, Supabase (PostgreSQL RPC functions)

**Spec:** `docs/superpowers/specs/2026-04-12-multi-dimension-bullseye-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/client/src/app/features/landscape/landscape-shell.component.ts` | Sidebar + `<router-outlet>` shell for landscape feature |
| `supabase/migrations/20260412120000_update_landscape_rpcs_generalized.sql` | Update existing `get_landscape_index` and `get_bullseye_data` to new generalized return shape |
| `supabase/migrations/20260412120100_create_landscape_index_by_dimension.sql` | New index RPCs for company, MOA, ROA |
| `supabase/migrations/20260412120200_create_bullseye_by_company.sql` | `get_bullseye_by_company` RPC |
| `supabase/migrations/20260412120300_create_bullseye_by_moa.sql` | `get_bullseye_by_moa` RPC |
| `supabase/migrations/20260412120400_create_bullseye_by_roa.sql` | `get_bullseye_by_roa` RPC |

### Modified Files
| File | Changes |
|---|---|
| `src/client/src/app/core/models/landscape.model.ts` | Add `BullseyeDimension`, `SpokeMode`, `BullseyeScope`, rename `BullseyeCompany` to `BullseyeSpoke`, update `BullseyeData` and `LandscapeIndexEntry` |
| `src/client/src/app/core/services/landscape.service.ts` | Add dimension routing to RPCs |
| `src/client/src/app/app.routes.ts` | New route structure with shell + dimension segments + backwards compat redirect |
| `src/client/src/app/features/landscape/bullseye-chart.component.ts` | Rename `companies` to `spokes` in all signals/computeds, generalize center text |
| `src/client/src/app/features/landscape/bullseye-chart.component.html` | Update template references from companies to spokes |
| `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts` | Add `dimension` input, contextual emphasis logic |
| `src/client/src/app/features/landscape/bullseye-detail-panel.component.html` | Conditional emphasis per dimension |
| `src/client/src/app/features/landscape/landscape-filter-bar.component.ts` | Add `dimension` input |
| `src/client/src/app/features/landscape/landscape-filter-bar.component.html` | `@if` guards to hide redundant filter |
| `src/client/src/app/features/landscape/landscape.component.ts` | Add `dimension` and `spokeMode` signals, remove TA selector, add spoke transformation |
| `src/client/src/app/features/landscape/landscape.component.html` | Add spoke toggle, remove TA selector, pass dimension |
| `src/client/src/app/features/landscape/landscape-index.component.ts` | Parameterize by dimension |
| `src/client/src/app/features/landscape/landscape-index.component.html` | Adapt labels and links per dimension |
| `src/client/src/app/features/landscape/landscape.css` | Add sidebar styles |
| `src/client/src/app/features/landscape/bullseye-geometry.ts` | Cosmetic rename `companyAngle` -> `spokeAngle`, etc. |

### Removed Files
| File | Reason |
|---|---|
| `src/client/src/app/features/landscape/ta-selector.component.ts` | Replaced by sidebar navigation |

---

## Task 1: Generalize Data Model

**Files:**
- Modify: `src/client/src/app/core/models/landscape.model.ts`

- [ ] **Step 1: Add new types and rename existing ones**

Replace the entire model file content. Key changes: add `BullseyeDimension`, `SpokeMode`, `BullseyeScope`; rename `BullseyeCompany` to `BullseyeSpoke`; update `BullseyeData` to use `scope`/`spokes`/`dimension`/`spoke_label`; update `LandscapeIndexEntry` to use `entity`/`secondary_count`/`secondary_label`.

In `src/client/src/app/core/models/landscape.model.ts`, add after the `PHASE_COLOR` constant (after line 55):

```typescript
export type BullseyeDimension = 'therapeutic-area' | 'company' | 'moa' | 'roa';

export type SpokeMode = 'grouped' | 'products';

export interface BullseyeScope {
  id: string;
  name: string;
  abbreviation?: string | null;
}
```

Then rename `BullseyeCompany` to `BullseyeSpoke` (lines 99-105):

Replace:
```typescript
export interface BullseyeCompany {
  id: string;
  name: string;
  display_order: number;
  highest_phase_rank: number;
  products: BullseyeProduct[];
}
```

With:
```typescript
export interface BullseyeSpoke {
  id: string;
  name: string;
  display_order: number;
  highest_phase_rank: number;
  products: BullseyeProduct[];
}
```

Then replace the `BullseyeData` interface (lines 107-111):

Replace:
```typescript
export interface BullseyeData {
  therapeutic_area: BullseyeTherapeuticArea | null;
  ring_order: RingPhase[];
  companies: BullseyeCompany[];
}
```

With:
```typescript
export interface BullseyeData {
  dimension: BullseyeDimension;
  scope: BullseyeScope;
  ring_order: RingPhase[];
  spokes: BullseyeSpoke[];
  spoke_label: string;
}
```

Then replace `LandscapeIndexEntry` (lines 133-139):

Replace:
```typescript
export interface LandscapeIndexEntry {
  therapeutic_area: BullseyeTherapeuticArea;
  product_count: number;
  company_count: number;
  highest_phase_present: RingPhase | null;
  products_missing_phase: number;
}
```

With:
```typescript
export interface LandscapeIndexEntry {
  entity: BullseyeScope;
  product_count: number;
  secondary_count: number;
  secondary_label: string;
  highest_phase_present: RingPhase | null;
  products_missing_phase: number;
}
```

- [ ] **Step 2: Verify build compiles (expect errors from consumers)**

Run: `cd src/client && npx ng build 2>&1 | head -60`

Expected: Compilation errors in components that reference `BullseyeCompany`, `data.companies`, `data.therapeutic_area`, `entry.therapeutic_area`, `entry.company_count`. This confirms the model changes propagated and we can fix consumers in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts
git commit -m "refactor(models): generalize bullseye data model for multi-dimension support"
```

---

## Task 2: Rename Geometry Functions (Cosmetic)

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-geometry.ts`

- [ ] **Step 1: Rename company-specific function names to spoke-generic names**

In `bullseye-geometry.ts`:

Rename `companyAngle` to `spokeAngle` (line 44 function declaration + export):
```typescript
export function spokeAngle(index: number, total: number): number {
```

Rename `companyLabelTransform` to `spokeLabelTransform` (line 154 function declaration + export, and the interface on line 147):
```typescript
export interface SpokeLabelTransform {
  x: number;
  y: number;
  rotate: number;
  anchor: 'start' | 'end';
}

export function spokeLabelTransform(angleRad: number, offset = 28): SpokeLabelTransform {
```

Also update `sectorAnnularPath` to use `spokeAngle` internally (line 121):
```typescript
  const base = spokeAngle(companyIndex, total);
```

And update `dotXY` to use `spokeAngle` (line 73):
```typescript
  return polarToCartesian(spokeAngle(companyIndex, totalCompanies), ringRadius(devRank));
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-geometry.ts
git commit -m "refactor(geometry): rename company-specific functions to spoke-generic names"
```

---

## Task 3: Update Bullseye Chart Component

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.ts`
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.html`

- [ ] **Step 1: Update imports in bullseye-chart.component.ts**

Replace the geometry imports (lines 11-24):

```typescript
import {
  SpokeLabelTransform,
  CX,
  CY,
  INNER_RADIUS,
  OUTER_RADIUS,
  annularBandPath,
  spokeAngle,
  spokeLabelTransform,
  jitterAngles,
  polarToCartesian,
  ringRadius,
  sectorAnnularPath,
  sectorWidth,
} from './bullseye-geometry';
```

Update the model import (lines 4-9) to use `BullseyeSpoke` instead of the old types:

```typescript
import {
  BullseyeData,
  BullseyeProduct,
  PHASE_COLOR,
  RingPhase,
} from '../../core/models/landscape.model';
```

- [ ] **Step 2: Rename internal interfaces and computed signals**

Rename `CompanyLabelSpec` interface (around line 51):

```typescript
interface SpokeLabelSpec extends SpokeLabelTransform {
  id: string;
  name: string;
  abbreviation: string;
}
```

Update `SpokeSpec` interface (line 33):
```typescript
interface SpokeLineSpec {
  spokeId: string;
  x2: number;
  y2: number;
}
```

Update `SectorSpec` interface (line 39):
```typescript
interface SectorSpec {
  spokeId: string;
  path: string;
  fill: string;
}
```

- [ ] **Step 3: Update computed signals to use spokes instead of companies**

Replace the `companies` and `totalCompanies` signals:
```typescript
  protected readonly spokes = computed(() => this.data()?.spokes ?? []);

  protected readonly totalSpokes = computed(() => this.spokes().length);
```

Update the `spokes` computed (rename from internal name clash -- call the line-drawing computed `spokeLines`):
```typescript
  protected readonly spokeLines = computed<SpokeLineSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    return spokes.map((s, i) => {
      const angle = spokeAngle(i, total);
      const endpoint = polarToCartesian(angle, OUTER_RADIUS);
      return { spokeId: s.id, x2: endpoint.x, y2: endpoint.y };
    });
  });
```

Update the `sectors` computed:
```typescript
  protected readonly sectors = computed<SectorSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    const tints = total % 2 === 0 ? ['#e2e8f0', '#ffffff'] : ['#e2e8f0', '#ffffff', '#f1f5f9'];
    return spokes.map((s, i) => ({
      spokeId: s.id,
      path: sectorAnnularPath(i, total),
      fill: tints[i % tints.length],
    }));
  });
```

Update the `companyLabels` computed to `spokeLabels`:
```typescript
  protected readonly spokeLabels = computed<SpokeLabelSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    const forceShrink = total > LABEL_SHRINK_THRESHOLD;
    return spokes.map((s, i) => {
      const transform = spokeLabelTransform(spokeAngle(i, total));
      const needsAbbreviation = forceShrink || s.name.length > LONG_NAME_THRESHOLD;
      const displayName = needsAbbreviation ? abbreviateSpokeName(s.name) : s.name.toUpperCase();
      return {
        id: s.id,
        name: displayName,
        abbreviation: s.name,
        ...transform,
      };
    });
  });
```

Update the `dots` computed:
```typescript
  protected readonly dots = computed<DotSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    const sectorW = sectorWidth(total);
    const out: DotSpec[] = [];

    spokes.forEach((spoke, spokeIndex) => {
      const byRank = new Map<number, BullseyeProduct[]>();
      for (const product of spoke.products) {
        const list = byRank.get(product.highest_phase_rank) ?? [];
        list.push(product);
        byRank.set(product.highest_phase_rank, list);
      }

      const baseAngle = spokeAngle(spokeIndex, total);

      for (const [devRank, products] of byRank) {
        const angles = jitterAngles(baseAngle, sectorW, products.length);
        for (let i = 0; i < products.length; i += 1) {
          const xy = polarToCartesian(angles[i], ringRadius(devRank));
          out.push({ product: products[i], x: xy.x, y: xy.y });
        }
      }
    });

    return out;
  });
```

Update `ariaLabel` and `productCountSummary`:
```typescript
  protected readonly ariaLabel = computed(() => {
    const scope = this.data()?.scope;
    const productCount = this.dots().length;
    const spokeCount = this.totalSpokes();
    if (!scope) return 'Competitive landscape bullseye chart';
    return `Competitive landscape bullseye for ${scope.name}. ${productCount} products across ${spokeCount} spokes.`;
  });

  protected readonly productCountSummary = computed(() => {
    const d = this.data();
    if (!d) return '';
    const productCount = this.dots().length;
    return `${productCount} ${productCount === 1 ? 'product' : 'products'}`;
  });
```

Update the center text computed signals (replace `taName` and `taAbbreviation`):
```typescript
  protected readonly scopeName = computed(() => this.data()?.scope?.name ?? '');
  protected readonly scopeAbbreviation = computed(() => this.data()?.scope?.abbreviation ?? '');
```

Rename `abbreviateCompanyName` to `abbreviateSpokeName`:
```typescript
function abbreviateSpokeName(name: string): string {
  const firstWord = name.split(/\s+/)[0] ?? name;
  return firstWord.slice(0, ABBREVIATION_MAX_LENGTH).toUpperCase();
}
```

- [ ] **Step 4: Update the SVG template**

In `bullseye-chart.component.html`, make these replacements:

Replace `sector.companyId` with `sector.spokeId` in the sector loop (line 17):
```html
  @for (sector of sectors(); track sector.spokeId) {
```

Replace `spoke.companyId` with `spoke.spokeId` in the spoke loop (line 40), and rename `spokes()` to `spokeLines()`:
```html
  @for (spoke of spokeLines(); track spoke.spokeId) {
```

Replace `taName()` with `scopeName()` in the center disc text (line 62):
```html
    {{ scopeName() }}
```

Replace `companyLabels()` with `spokeLabels()` in the label loop (line 89):
```html
  @for (label of spokeLabels(); track label.id) {
```

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-chart.component.ts src/client/src/app/features/landscape/bullseye-chart.component.html
git commit -m "refactor(bullseye-chart): generalize from companies to spokes"
```

---

## Task 4: Update Detail Panel Component

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts`
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.html`

- [ ] **Step 1: Add dimension input and update computed signals**

In `bullseye-detail-panel.component.ts`:

Add `BullseyeDimension` to the model import:
```typescript
import {
  BullseyeData,
  BullseyeDimension,
  BullseyeProduct,
  PHASE_COLOR,
  RING_ORDER,
  RingPhase,
} from '../../core/models/landscape.model';
```

Add the dimension input after the existing inputs:
```typescript
  readonly dimension = input<BullseyeDimension>('therapeutic-area');
```

Update `allProducts` to use `spokes` instead of `companies`:
```typescript
  protected readonly allProducts = computed(() => {
    return this.data()?.spokes.flatMap((s) => s.products) ?? [];
  });
```

Update `totalCompanies` to `totalSpokes`:
```typescript
  protected readonly totalSpokes = computed(() => this.data()?.spokes.length ?? 0);
```

Update `therapeuticAreaName` to `scopeName`:
```typescript
  protected readonly scopeName = computed(
    () => this.data()?.scope?.name ?? ''
  );
```

Add a computed for the spoke label:
```typescript
  protected readonly spokeLabel = computed(() => this.data()?.spoke_label ?? 'Companies');
```

Add a computed for whether the scoped MOA/ROA matches a product's pill:
```typescript
  protected isScopedMoa(moaId: string): boolean {
    const d = this.data();
    return d?.dimension === 'moa' && d.scope.id === moaId;
  }

  protected isScopedRoa(roaId: string): boolean {
    const d = this.data();
    return d?.dimension === 'roa' && d.scope.id === roaId;
  }
```

Update `onOpenTimeline` to use scope:
```typescript
  protected onOpenTimeline(): void {
    const p = this.selectedProduct();
    const d = this.data();
    if (p && d?.scope) {
      this.openInTimeline.emit({ productId: p.id, therapeuticAreaId: d.scope.id });
    }
  }
```

- [ ] **Step 2: Update the detail panel template**

In `bullseye-detail-panel.component.html`:

Update the company section to de-emphasize when dimension is 'company' (replace lines 34-39):
```html
    @if (dimension() !== 'company') {
      <section class="landscape-detail-section">
        <div class="landscape-detail-label">COMPANY</div>
        <button type="button" class="landscape-detail-company-link" (click)="onCompanyClick()">
          {{ product.company_name }} →
        </button>
      </section>
    }
```

Update MOA pills to highlight the scoped MOA (replace lines 41-49):
```html
    @if (product.moas.length > 0) {
      <section class="landscape-detail-section">
        <div class="landscape-detail-label">MECHANISM OF ACTION</div>
        <div class="flex flex-wrap gap-1">
          @for (moa of product.moas; track moa.id) {
            <span
              class="inline-block rounded-sm text-[11px] px-2 py-0.5"
              [class.bg-teal-100]="isScopedMoa(moa.id)"
              [class.text-teal-800]="isScopedMoa(moa.id)"
              [class.font-semibold]="isScopedMoa(moa.id)"
              [class.bg-slate-100]="!isScopedMoa(moa.id)"
              [class.text-slate-700]="!isScopedMoa(moa.id)"
            >{{ moa.name }}</span>
          }
        </div>
      </section>
    }
```

Update ROA pills to highlight the scoped ROA (replace lines 51-59):
```html
    @if (product.roas.length > 0) {
      <section class="landscape-detail-section">
        <div class="landscape-detail-label">ROUTE OF ADMINISTRATION</div>
        <div class="flex flex-wrap gap-1">
          @for (roa of product.roas; track roa.id) {
            <span
              class="inline-block rounded-sm text-[11px] px-2 py-0.5"
              [class.bg-teal-100]="isScopedRoa(roa.id)"
              [class.text-teal-800]="isScopedRoa(roa.id)"
              [class.font-semibold]="isScopedRoa(roa.id)"
              [class.bg-slate-100]="!isScopedRoa(roa.id)"
              [class.text-slate-700]="!isScopedRoa(roa.id)"
              [attr.title]="roa.name"
            >{{ roa.abbreviation ?? roa.name }}</span>
          }
        </div>
      </section>
    }
```

Update "HIGHEST PHASE IN ..." label (line 64):
```html
      <div class="landscape-detail-label">
        HIGHEST PHASE IN {{ scopeName().toUpperCase() }}
      </div>
```

Update "TRIALS IN THIS TA" label (line 73):
```html
      <div class="landscape-detail-label">TRIALS ({{ product.trials.length }})</div>
```

Update the summary line in empty state to use `totalSpokes()` and `spokeLabel()` (lines 139-142):
```html
      <p class="landscape-detail-summary">
        {{ totalProducts() }} {{ totalProducts() === 1 ? 'product' : 'products' }} across
        {{ totalSpokes() }} {{ spokeLabel().toLowerCase() }}
      </p>
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-detail-panel.component.ts src/client/src/app/features/landscape/bullseye-detail-panel.component.html
git commit -m "refactor(detail-panel): add dimension input and contextual emphasis"
```

---

## Task 5: Update Filter Bar Component

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`

- [ ] **Step 1: Add dimension input to filter bar component**

In `landscape-filter-bar.component.ts`, add the import:
```typescript
import {
  BullseyeDimension,
  BullseyeProduct,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  RingPhase,
} from '../../core/models/landscape.model';
```

Add the dimension input after the existing inputs:
```typescript
  readonly dimension = input<BullseyeDimension>('therapeutic-area');
```

- [ ] **Step 2: Add conditional visibility in template**

In `landscape-filter-bar.component.html`, wrap each dimension-specific filter with `@if`:

Wrap the MOA multiselect (lines 6-19):
```html
  @if (dimension() !== 'moa') {
    <p-multiselect
      [options]="moaOptions()"
      ...existing attributes...
    />
  }
```

Wrap the ROA multiselect (lines 20-33):
```html
  @if (dimension() !== 'roa') {
    <p-multiselect
      [options]="roaOptions()"
      ...existing attributes...
    />
  }
```

Wrap the Company multiselect (lines 34-47):
```html
  @if (dimension() !== 'company') {
    <p-multiselect
      [options]="companyOptions()"
      ...existing attributes...
    />
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-filter-bar.component.ts src/client/src/app/features/landscape/landscape-filter-bar.component.html
git commit -m "refactor(filter-bar): hide redundant filter for active dimension"
```

---

## Task 6: Update Landscape Container Component

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape.component.html`

- [ ] **Step 1: Update the TypeScript component**

In `landscape.component.ts`:

Update imports -- remove `TaSelectorComponent`, add `SelectButton` and `FormsModule`, add new model types:
```typescript
import { Component, computed, effect, HostListener, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { SelectButton } from 'primeng/selectbutton';

import {
  BullseyeDimension,
  BullseyeProduct,
  BullseyeSpoke,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  RingPhase,
  SpokeMode,
} from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { BullseyeChartComponent } from './bullseye-chart.component';
import { BullseyeDetailPanelComponent } from './bullseye-detail-panel.component';
import { LandscapeFilterBarComponent } from './landscape-filter-bar.component';
```

Update the `@Component` decorator `imports` array -- remove `TaSelectorComponent`, add `SelectButton` and `FormsModule`:
```typescript
  imports: [
    BullseyeChartComponent,
    BullseyeDetailPanelComponent,
    LandscapeFilterBarComponent,
    RouterLink,
    FormsModule,
    ButtonModule,
    MessageModule,
    ProgressSpinner,
    SelectButton,
  ],
```

Remove the `TherapeuticAreaService` inject and `therapeuticAreas` signal. Replace `taId` with `entityId`. Add `dimension` and `spokeMode` signals:

```typescript
  private readonly landscapeService = inject(LandscapeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly entityId = signal('');
  readonly dimension = signal<BullseyeDimension>('therapeutic-area');

  readonly selectedProductId = signal<string | null>(null);
  readonly hoveredProductId = signal<string | null>(null);
  readonly highlightedRing = signal<RingPhase | null>(null);

  readonly landscapeFilters = signal<LandscapeFilters>({ ...EMPTY_LANDSCAPE_FILTERS });
  readonly spokeMode = signal<SpokeMode>('grouped');
```

Add a helper to parse the route segment into a dimension:
```typescript
  private static parseDimension(segment: string): BullseyeDimension {
    const map: Record<string, BullseyeDimension> = {
      'by-therapy-area': 'therapeutic-area',
      'by-company': 'company',
      'by-moa': 'moa',
      'by-roa': 'roa',
    };
    return map[segment] ?? 'therapeutic-area';
  }
```

Add spoke mode toggle options (computed from data):
```typescript
  readonly spokeModeOptions = computed(() => {
    const label = this.bullseyeData.value()?.spoke_label ?? 'Groups';
    return [
      { label, value: 'grouped' as SpokeMode },
      { label: 'Products', value: 'products' as SpokeMode },
    ];
  });
```

Update the `bullseyeData` resource to use `dimension` and `entityId`:
```typescript
  readonly bullseyeData = resource({
    request: () => ({
      spaceId: this.spaceId(),
      dimension: this.dimension(),
      entityId: this.entityId(),
    }),
    loader: async ({ request }) => {
      if (!request.spaceId || !request.entityId) return null;
      return this.landscapeService.getBullseyeData(
        request.spaceId,
        request.dimension,
        request.entityId
      );
    },
  });
```

Update `allProducts` to use `spokes`:
```typescript
  readonly allProducts = computed<BullseyeProduct[]>(() => {
    return this.bullseyeData.value()?.spokes.flatMap((s) => s.products) ?? [];
  });
```

Add a computed for the chart data (applies spoke mode transformation):
```typescript
  readonly chartData = computed(() => {
    const data = this.bullseyeData.value();
    if (!data) return null;
    if (this.spokeMode() === 'grouped') return data;

    // Products mode: flatten all products into individual spokes
    const allProducts = data.spokes.flatMap((s) => s.products);
    const productSpokes: BullseyeSpoke[] = allProducts.map((p) => ({
      id: p.id,
      name: p.name,
      display_order: 0,
      highest_phase_rank: p.highest_phase_rank,
      products: [p],
    }));
    return { ...data, spokes: productSpokes, spoke_label: 'Products' };
  });
```

Update the constructor effects to use `entityId` instead of `taId`, and `spokes` instead of `companies`:
```typescript
  constructor() {
    effect(() => {
      const params = this.route.snapshot.paramMap;
      this.tenantId.set(params.get('tenantId') ?? '');
      this.spaceId.set(params.get('spaceId') ?? '');
      this.entityId.set(params.get('entityId') ?? '');
      const queryProduct = this.route.snapshot.queryParamMap.get('product');
      this.selectedProductId.set(queryProduct);
    });

    effect(() => {
      const data = this.bullseyeData.value();
      const currentSelected = this.selectedProductId();
      if (!data || !currentSelected) return;
      const exists = data.spokes.some((s) => s.products.some((p) => p.id === currentSelected));
      if (!exists) {
        this.selectedProductId.set(null);
        this.updateQueryParam(null);
      }
    });
  }
```

Update `ngOnInit` -- remove TA list loading, parse dimension from route:
```typescript
  async ngOnInit(): Promise<void> {
    const tenantId = this.route.snapshot.paramMap.get('tenantId') ?? '';
    const spaceId = this.route.snapshot.paramMap.get('spaceId') ?? '';
    this.tenantId.set(tenantId);
    this.spaceId.set(spaceId);
    this.entityId.set(this.route.snapshot.paramMap.get('entityId') ?? '');
    this.selectedProductId.set(this.route.snapshot.queryParamMap.get('product'));

    // Parse dimension from the parent route segment
    const urlSegments = this.route.parent?.snapshot.url ?? [];
    const dimensionSegment = urlSegments.find((s) =>
      ['by-therapy-area', 'by-company', 'by-moa', 'by-roa'].includes(s.path)
    );
    if (dimensionSegment) {
      this.dimension.set(LandscapeComponent.parseDimension(dimensionSegment.path));
    }

    this.route.paramMap.subscribe((params) => {
      this.tenantId.set(params.get('tenantId') ?? '');
      this.spaceId.set(params.get('spaceId') ?? '');
      this.entityId.set(params.get('entityId') ?? '');
    });
    this.route.queryParamMap.subscribe((qp) => {
      this.selectedProductId.set(qp.get('product'));
    });
  }
```

Remove the `onTaSelect` method entirely.

- [ ] **Step 2: Update the template**

Replace `landscape.component.html` entirely:

```html
<div class="flex flex-col h-full">
  <!-- Header bar with spoke mode toggle -->
  <div class="flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-200 bg-white">
    <div class="flex items-center gap-2">
      <span class="text-sm font-semibold text-slate-700">{{ bullseyeData.value()?.scope?.name }}</span>
    </div>
    @if (bullseyeData.value()?.spokes?.length) {
      <p-selectbutton
        [options]="spokeModeOptions()"
        [ngModel]="spokeMode()"
        (ngModelChange)="spokeMode.set($event)"
        optionLabel="label"
        optionValue="value"
        size="small"
        aria-label="Group spokes by"
      />
    }
  </div>

  <!-- Main area: chart + detail panel -->
  <div class="flex-1 overflow-hidden">
    @if (bullseyeData.isLoading()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3">
          <p-progressspinner
            strokeWidth="4"
            [style]="{ width: '2rem', height: '2rem' }"
            aria-label="Loading landscape data"
          />
          <span class="text-sm text-slate-500">Loading landscape data...</span>
        </div>
      </div>
    } @else if (bullseyeData.error()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 text-center max-w-md">
          <p-message severity="error" [closable]="false">
            Failed to load landscape data: {{ bullseyeData.error() }}
          </p-message>
          <p-button label="Retry" severity="primary" size="small" (onClick)="retry()" />
        </div>
      </div>
    } @else {
      @if (chartData(); as cd) {
        @if (cd.spokes.length === 0) {
          <div class="flex items-center justify-center h-full">
            <div class="flex flex-col items-center gap-3 text-center max-w-md">
              <p-message severity="info" [closable]="false">
                No products tracked for {{ bullseyeData.value()?.scope?.name }} yet.
                Add products and trials to see them here.
              </p-message>
              <p-button
                label="Manage products"
                severity="secondary"
                size="small"
                [routerLink]="['/t', tenantId(), 's', spaceId(), 'manage', 'products']"
              />
            </div>
          </div>
        } @else {
          <app-landscape-filter-bar
            [spaceId]="spaceId()"
            [products]="allProducts()"
            [filters]="landscapeFilters()"
            [dimension]="dimension()"
            (filtersChange)="onLandscapeFiltersChange($event)"
          />
          <div class="landscape-layout">
            <div class="landscape-chart-wrap">
              <div class="bullseye-chart-frame">
              <app-bullseye-chart
                [data]="cd"
                [selectedProductId]="selectedProductId()"
                [hoveredProductId]="hoveredProductId()"
                [highlightedRing]="highlightedRing()"
                [matchedProductIds]="matchedProductIds()"
                (productHover)="onProductHover($event)"
                (productClick)="onProductClick($event)"
                (backgroundClick)="onBackgroundClick()"
              />
              </div>
            </div>
            <div class="landscape-panel-wrap">
              <app-bullseye-detail-panel
                [data]="bullseyeData.value()!"
                [dimension]="dimension()"
                [selectedProduct]="selectedProduct()"
                (openTrial)="onOpenTrial($event)"
                (openCompany)="onOpenCompany()"
                (openInTimeline)="onOpenInTimeline($event)"
                (ringHighlightToggle)="onRingHighlightToggle($event)"
                (clearSelection)="onClearSelection()"
              />
            </div>
          </div>
        }
      }
    }
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/landscape.component.ts src/client/src/app/features/landscape/landscape.component.html
git commit -m "refactor(landscape): add dimension and spoke mode support"
```

---

## Task 7: Update Landscape Index Component

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-index.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-index.component.html`

- [ ] **Step 1: Parameterize index component by dimension**

In `landscape-index.component.ts`, update imports:
```typescript
import { Component, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import { BullseyeDimension } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
```

Add dimension signal and update the resource:
```typescript
export class LandscapeIndexComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly route = inject(ActivatedRoute);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly dimension = signal<BullseyeDimension>('therapeutic-area');

  private static parseDimension(segment: string): BullseyeDimension {
    const map: Record<string, BullseyeDimension> = {
      'by-therapy-area': 'therapeutic-area',
      'by-company': 'company',
      'by-moa': 'moa',
      'by-roa': 'roa',
    };
    return map[segment] ?? 'therapeutic-area';
  }

  readonly indexData = resource({
    request: () => ({
      spaceId: this.spaceId(),
      dimension: this.dimension(),
    }),
    loader: async ({ request }) => {
      if (!request.spaceId) return [];
      return this.landscapeService.getLandscapeIndex(request.spaceId, request.dimension);
    },
  });

  ngOnInit(): void {
    this.tenantId.set(this.route.snapshot.paramMap.get('tenantId') ?? '');
    this.spaceId.set(this.route.snapshot.paramMap.get('spaceId') ?? '');

    // Parse dimension from current URL segment
    const url = this.route.snapshot.url;
    const dimSegment = url.find((s) =>
      ['by-therapy-area', 'by-company', 'by-moa', 'by-roa'].includes(s.path)
    );
    if (dimSegment) {
      this.dimension.set(LandscapeIndexComponent.parseDimension(dimSegment.path));
    }
  }

  retry(): void {
    this.indexData.reload();
  }

  protected dimensionLabel(): string {
    const labels: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'All therapeutic areas',
      'company': 'All companies',
      'moa': 'All mechanisms of action',
      'roa': 'All routes of administration',
    };
    return labels[this.dimension()];
  }

  protected emptyMessage(): string {
    const messages: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'No therapeutic areas tracked yet. Add one to start building a landscape view.',
      'company': 'No companies tracked yet. Add companies and products to see them here.',
      'moa': 'No mechanisms of action defined yet. Add them in Manage to start.',
      'roa': 'No routes of administration defined yet. Add them in Manage to start.',
    };
    return messages[this.dimension()];
  }

  protected routeSegment(): string {
    const segments: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'by-therapy-area',
      'company': 'by-company',
      'moa': 'by-moa',
      'roa': 'by-roa',
    };
    return segments[this.dimension()];
  }
}
```

- [ ] **Step 2: Update the index template**

Replace `landscape-index.component.html`:

```html
<div class="flex flex-col h-full">
  <div class="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white">
    <span class="text-sm text-slate-700">{{ dimensionLabel() }}</span>
  </div>

  <div class="flex-1 overflow-auto p-6">
    @if (indexData.isLoading()) {
      <div class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3">
          <p-progressspinner
            strokeWidth="4"
            [style]="{ width: '2rem', height: '2rem' }"
            aria-label="Loading entries"
          />
          <span class="text-sm text-slate-500">Loading...</span>
        </div>
      </div>
    } @else if (indexData.error()) {
      <div class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3 text-center max-w-md">
          <p-message severity="error" [closable]="false">
            Failed to load index: {{ indexData.error() }}
          </p-message>
          <p-button label="Retry" severity="primary" size="small" (onClick)="retry()" />
        </div>
      </div>
    } @else if (indexData.value()) {
      @let entries = indexData.value()!;
      @if (entries.length === 0) {
        <div class="flex items-center justify-center py-20">
          <div class="flex flex-col items-center gap-3 text-center max-w-md">
            <p-message severity="info" [closable]="false">
              {{ emptyMessage() }}
            </p-message>
          </div>
        </div>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (entry of entries; track entry.entity.id) {
            <a
              class="landscape-index-card"
              [routerLink]="['/t', tenantId(), 's', spaceId(), 'landscape', routeSegment(), entry.entity.id]"
            >
              <div class="landscape-index-card-title">{{ entry.entity.name }}</div>
              @if (entry.entity.abbreviation) {
                <div class="landscape-index-card-abbr">{{ entry.entity.abbreviation }}</div>
              }
              <div class="landscape-index-card-stats">
                <span>{{ entry.product_count }} {{ entry.product_count === 1 ? 'product' : 'products' }}</span>
                <span class="landscape-index-card-sep">&middot;</span>
                <span>{{ entry.secondary_count }} {{ entry.secondary_label }}</span>
              </div>
              @if (entry.highest_phase_present) {
                <div class="landscape-index-card-phase">
                  Highest phase: <strong>{{ entry.highest_phase_present }}</strong>
                </div>
              } @else {
                <div class="landscape-index-card-phase landscape-index-card-phase--empty">
                  No phase data
                </div>
              }
              @if (entry.products_missing_phase > 0) {
                <div class="landscape-index-card-warning">
                  {{ entry.products_missing_phase }}
                  {{ entry.products_missing_phase === 1 ? 'product' : 'products' }}
                  missing phase data
                </div>
              }
            </a>
          }
        </div>
      }
    }
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-index.component.ts src/client/src/app/features/landscape/landscape-index.component.html
git commit -m "refactor(landscape-index): parameterize by dimension"
```

---

## Task 8: Create Landscape Shell Component and Update Routes

**Files:**
- Create: `src/client/src/app/features/landscape/landscape-shell.component.ts`
- Modify: `src/client/src/app/app.routes.ts`
- Modify: `src/client/src/app/features/landscape/landscape.css`

- [ ] **Step 1: Create the shell component**

Create `src/client/src/app/features/landscape/landscape-shell.component.ts`:

```typescript
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-landscape-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="landscape-shell">
      <nav class="landscape-sidebar" aria-label="Landscape dimensions">
        <a
          routerLink="by-therapy-area"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by therapy area"
        >
          <i class="pi pi-th-large"></i>
          <span>Therapy Area</span>
        </a>
        <a
          routerLink="by-company"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by company"
        >
          <i class="pi pi-building"></i>
          <span>Company</span>
        </a>
        <a
          routerLink="by-moa"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by mechanism of action"
        >
          <i class="pi pi-sitemap"></i>
          <span>Mechanism of Action</span>
        </a>
        <a
          routerLink="by-roa"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by route of administration"
        >
          <i class="pi pi-directions"></i>
          <span>Route of Admin</span>
        </a>
      </nav>
      <main class="landscape-main">
        <router-outlet />
      </main>
    </div>
  `,
})
export class LandscapeShellComponent {}
```

- [ ] **Step 2: Add sidebar CSS styles**

In `landscape.css`, add at the top after the header comment (before the layout section):

```css
/* =============================================================================
 * Shell — sidebar + main content layout
 * ============================================================================= */

.landscape-shell {
  display: flex;
  height: 100%;
}

.landscape-sidebar {
  display: flex;
  flex-direction: column;
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid #e2e8f0;
  background: #ffffff;
  padding: 0.75rem 0;
}

.landscape-sidebar-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 1rem;
  font-size: 0.8125rem;
  color: #475569;
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: color 120ms ease-out, border-color 120ms ease-out;
}

.landscape-sidebar-item:hover {
  color: #0f172a;
  background: #f8fafc;
}

.landscape-sidebar-item.active {
  color: #0d9488;
  border-left-color: #0d9488;
  font-weight: 600;
  background: #f0fdfa;
}

.landscape-sidebar-item i {
  font-size: 1rem;
  width: 1.25rem;
  text-align: center;
}

.landscape-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

@media (max-width: 768px) {
  .landscape-shell {
    flex-direction: column;
  }
  .landscape-sidebar {
    width: 100%;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid #e2e8f0;
    padding: 0;
    overflow-x: auto;
  }
  .landscape-sidebar-item {
    border-left: none;
    border-bottom: 3px solid transparent;
    white-space: nowrap;
    padding: 0.5rem 0.75rem;
  }
  .landscape-sidebar-item.active {
    border-bottom-color: #0d9488;
    border-left-color: transparent;
  }
}
```

- [ ] **Step 3: Update routes in app.routes.ts**

Replace the two landscape routes (lines 45-57) with the new shell + dimension structure:

```typescript
          {
            path: 'landscape',
            loadComponent: () =>
              import('./features/landscape/landscape-shell.component').then(
                (m) => m.LandscapeShellComponent
              ),
            children: [
              {
                path: '',
                pathMatch: 'full',
                redirectTo: 'by-therapy-area',
              },
              {
                path: 'by-therapy-area',
                loadComponent: () =>
                  import('./features/landscape/landscape-index.component').then(
                    (m) => m.LandscapeIndexComponent
                  ),
              },
              {
                path: 'by-therapy-area/:entityId',
                loadComponent: () =>
                  import('./features/landscape/landscape.component').then(
                    (m) => m.LandscapeComponent
                  ),
              },
              {
                path: 'by-company',
                loadComponent: () =>
                  import('./features/landscape/landscape-index.component').then(
                    (m) => m.LandscapeIndexComponent
                  ),
              },
              {
                path: 'by-company/:entityId',
                loadComponent: () =>
                  import('./features/landscape/landscape.component').then(
                    (m) => m.LandscapeComponent
                  ),
              },
              {
                path: 'by-moa',
                loadComponent: () =>
                  import('./features/landscape/landscape-index.component').then(
                    (m) => m.LandscapeIndexComponent
                  ),
              },
              {
                path: 'by-moa/:entityId',
                loadComponent: () =>
                  import('./features/landscape/landscape.component').then(
                    (m) => m.LandscapeComponent
                  ),
              },
              {
                path: 'by-roa',
                loadComponent: () =>
                  import('./features/landscape/landscape-index.component').then(
                    (m) => m.LandscapeIndexComponent
                  ),
              },
              {
                path: 'by-roa/:entityId',
                loadComponent: () =>
                  import('./features/landscape/landscape.component').then(
                    (m) => m.LandscapeComponent
                  ),
              },
              {
                path: ':therapeuticAreaId',
                redirectTo: 'by-therapy-area/:therapeuticAreaId',
              },
            ],
          },
```

- [ ] **Step 4: Delete the TA selector component**

Remove `src/client/src/app/features/landscape/ta-selector.component.ts` (it was an inline-template component, so only one file).

- [ ] **Step 5: Verify the build compiles**

Run: `cd src/client && ng build 2>&1 | tail -20`

Expected: Build succeeds (or only fails on missing RPC endpoints at runtime, not compile errors). All Angular template and TypeScript references should resolve.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-shell.component.ts src/client/src/app/app.routes.ts src/client/src/app/features/landscape/landscape.css
git rm src/client/src/app/features/landscape/ta-selector.component.ts
git commit -m "feat(landscape): add shell with sidebar navigation and dimension routing"
```

---

## Task 9: Update Landscape Service

**Files:**
- Modify: `src/client/src/app/core/services/landscape.service.ts`

- [ ] **Step 1: Add dimension routing to the service**

Replace the entire service file:

```typescript
import { inject, Injectable } from '@angular/core';

import { BullseyeData, BullseyeDimension, LandscapeIndexEntry } from '../models/landscape.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class LandscapeService {
  private supabase = inject(SupabaseService);

  async getLandscapeIndex(
    spaceId: string,
    dimension: BullseyeDimension
  ): Promise<LandscapeIndexEntry[]> {
    const rpcMap: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'get_landscape_index',
      company: 'get_landscape_index_by_company',
      moa: 'get_landscape_index_by_moa',
      roa: 'get_landscape_index_by_roa',
    };
    const { data, error } = await this.supabase.client.rpc(rpcMap[dimension], {
      p_space_id: spaceId,
    });
    if (error) throw error;
    return (data ?? []) as LandscapeIndexEntry[];
  }

  async getBullseyeData(
    spaceId: string,
    dimension: BullseyeDimension,
    entityId: string
  ): Promise<BullseyeData> {
    const rpcMap: Record<BullseyeDimension, { name: string; paramKey: string }> = {
      'therapeutic-area': { name: 'get_bullseye_data', paramKey: 'p_therapeutic_area_id' },
      company: { name: 'get_bullseye_by_company', paramKey: 'p_company_id' },
      moa: { name: 'get_bullseye_by_moa', paramKey: 'p_moa_id' },
      roa: { name: 'get_bullseye_by_roa', paramKey: 'p_roa_id' },
    };
    const { name, paramKey } = rpcMap[dimension];
    const { data, error } = await this.supabase.client.rpc(name, {
      p_space_id: spaceId,
      [paramKey]: entityId,
    });
    if (error) throw error;
    return data as BullseyeData;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/landscape.service.ts
git commit -m "feat(service): add dimension routing for landscape RPCs"
```

---

## Task 10: Update Existing RPCs to Generalized Shape

**Files:**
- Create: `supabase/migrations/20260412120000_update_landscape_rpcs_generalized.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260412120000_update_landscape_rpcs_generalized.sql`:

```sql
-- migration: 20260412120000_update_landscape_rpcs_generalized
-- purpose: update get_landscape_index and get_bullseye_data to return the
--          generalized shape expected by the multi-dimension bullseye client.
--          get_landscape_index: therapeutic_area -> entity, company_count -> secondary_count + secondary_label
--          get_bullseye_data: therapeutic_area -> scope, companies -> spokes, add dimension + spoke_label
-- affected objects: public.get_landscape_index, public.get_bullseye_data (functions)

create or replace function public.get_landscape_index(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(ta_obj order by ta.name), '[]'::jsonb)
  into result
  from public.therapeutic_areas ta
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        p.company_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6
          when 'APPROVED' then 5
          when 'P4'       then 4
          when 'P3'       then 3
          when 'P2'       then 2
          when 'P1'       then 1
          when 'PRECLIN'  then 0
          else null
        end) as max_rank
      from public.products p
      join public.trials t
        on t.product_id = p.id
       and t.space_id = p_space_id
       and t.therapeutic_area_id = ta.id
      left join public.trial_phases tp
        on tp.trial_id = t.id
       and tp.space_id = p_space_id
       and tp.phase_type <> 'OBS'
      where p.space_id = p_space_id
      group by p.id, p.company_id
    )
    select jsonb_build_object(
      'entity', jsonb_build_object(
        'id', ta.id,
        'name', ta.name,
        'abbreviation', ta.abbreviation
      ),
      'product_count', (
        select count(*) from product_rollup where max_rank is not null
      ),
      'secondary_count', (
        select count(distinct company_id) from product_rollup where max_rank is not null
      ),
      'secondary_label', 'companies',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED'
          when 5 then 'APPROVED'
          when 4 then 'P4'
          when 3 then 'P3'
          when 2 then 'P2'
          when 1 then 'P1'
          when 0 then 'PRECLIN'
          else null
        end
        from product_rollup
        where max_rank is not null
      ),
      'products_missing_phase', (
        select count(*) from product_rollup where max_rank is null
      )
    ) as ta_obj
  ) as ta_lateral
  where ta.space_id = p_space_id;

  return result;
end;
$$;

create or replace function public.get_bullseye_data(
  p_space_id uuid,
  p_therapeutic_area_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_scope jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object(
    'id', ta.id,
    'name', ta.name,
    'abbreviation', ta.abbreviation
  )
  into v_scope
  from public.therapeutic_areas ta
  where ta.id = p_therapeutic_area_id
    and ta.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'therapeutic-area',
      'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb,
      'spoke_label', 'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id            as product_id,
      p.company_id    as company_id,
      p.name          as product_name,
      p.generic_name  as generic_name,
      p.logo_url      as logo_url,
      max(case tp.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) as max_rank
    from public.products p
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.therapeutic_area_id = p_therapeutic_area_id
    join public.trial_phases tp
      on tp.trial_id = t.id
     and tp.space_id = p_space_id
     and tp.phase_type <> 'OBS'
    where p.space_id = p_space_id
    group by p.id, p.company_id, p.name, p.generic_name, p.logo_url
    having max(case tp.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) is not null
  ),
  company_rank as (
    select
      company_id,
      max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id', pr.product_id,
            'name', pr.product_name,
            'generic_name', pr.generic_name,
            'logo_url', pr.logo_url,
            'company_id', pr.company_id,
            'company_name', c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED'
              when 5 then 'APPROVED'
              when 4 then 'P4'
              when 3 then 'P3'
              when 2 then 'P2'
              when 1 then 'P1'
              when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action m on m.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id,
                  'name', t.name,
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', (
                    select tp.phase_type
                    from public.trial_phases tp
                    where tp.trial_id = t.id
                      and tp.space_id = p_space_id
                    order by case tp.phase_type
                      when 'LAUNCHED' then 6
                      when 'APPROVED' then 5
                      when 'P4'       then 4
                      when 'P3'       then 3
                      when 'P2'       then 2
                      when 'P1'       then 1
                      when 'PRECLIN'  then 0
                      else -1
                    end desc,
                    tp.start_date desc
                    limit 1
                  )
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id
                and t.therapeutic_area_id = p_therapeutic_area_id
                and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', tmm.id,
                  'event_date', tmm.event_date,
                  'marker_type_name', mt.name,
                  'icon', mt.icon,
                  'shape', mt.shape,
                  'color', mt.color
                ) order by tmm.event_date desc
              ), '[]'::jsonb)
              from (
                select tm.id, tm.event_date, tm.marker_type_id
                from public.trial_markers tm
                join public.trials t2 on t2.id = tm.trial_id
                where t2.product_id = pr.product_id
                  and t2.therapeutic_area_id = p_therapeutic_area_id
                  and t2.space_id = p_space_id
                  and tm.space_id = p_space_id
                order by tm.event_date desc
                limit 3
              ) tmm
              join public.marker_types mt on mt.id = tmm.marker_type_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'therapeutic-area',
    'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260412120000_update_landscape_rpcs_generalized.sql
git commit -m "feat(db): update existing landscape RPCs to generalized shape"
```

---

## Task 11: Create Index RPCs for Company, MOA, ROA

**Files:**
- Create: `supabase/migrations/20260412120100_create_landscape_index_by_dimension.sql`

- [ ] **Step 1: Write the migration with three index functions**

Create `supabase/migrations/20260412120100_create_landscape_index_by_dimension.sql`:

```sql
-- migration: 20260412120100_create_landscape_index_by_dimension
-- purpose: create index RPCs for company, moa, and roa dimensions.
--          each returns the same shape as get_landscape_index but scoped
--          to the relevant dimension.
-- affected objects: public.get_landscape_index_by_company,
--                   public.get_landscape_index_by_moa,
--                   public.get_landscape_index_by_roa (functions)

-- ============================================================================
-- Index by Company
-- ============================================================================
create or replace function public.get_landscape_index_by_company(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(entry_obj order by c.name), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        t.therapeutic_area_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end) as max_rank
      from public.products p
      join public.trials t on t.product_id = p.id and t.space_id = p_space_id
      left join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
      where p.space_id = p_space_id
        and p.company_id = c.id
      group by p.id, t.therapeutic_area_id
    )
    select jsonb_build_object(
      'entity', jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', null),
      'product_count', (select count(distinct product_id) from product_rollup where max_rank is not null),
      'secondary_count', (select count(distinct therapeutic_area_id) from product_rollup where max_rank is not null),
      'secondary_label', 'therapeutic areas',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
          when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          else null
        end from product_rollup where max_rank is not null
      ),
      'products_missing_phase', (select count(distinct product_id) from product_rollup where max_rank is null)
    ) as entry_obj
  ) as entry_lateral
  where c.space_id = p_space_id;

  return result;
end;
$$;

-- ============================================================================
-- Index by MOA
-- ============================================================================
create or replace function public.get_landscape_index_by_moa(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(entry_obj order by m.display_order, m.name), '[]'::jsonb)
  into result
  from public.mechanisms_of_action m
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        p.company_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end) as max_rank
      from public.product_mechanisms_of_action pmoa
      join public.products p on p.id = pmoa.product_id and p.space_id = p_space_id
      join public.trials t on t.product_id = p.id and t.space_id = p_space_id
      left join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
      where pmoa.moa_id = m.id
      group by p.id, p.company_id
    )
    select jsonb_build_object(
      'entity', jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', null),
      'product_count', (select count(*) from product_rollup where max_rank is not null),
      'secondary_count', (select count(distinct company_id) from product_rollup where max_rank is not null),
      'secondary_label', 'companies',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
          when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          else null
        end from product_rollup where max_rank is not null
      ),
      'products_missing_phase', (select count(*) from product_rollup where max_rank is null)
    ) as entry_obj
  ) as entry_lateral
  where m.space_id = p_space_id;

  return result;
end;
$$;

-- ============================================================================
-- Index by ROA
-- ============================================================================
create or replace function public.get_landscape_index_by_roa(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(entry_obj order by r.display_order, r.name), '[]'::jsonb)
  into result
  from public.routes_of_administration r
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        p.company_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end) as max_rank
      from public.product_routes_of_administration proa
      join public.products p on p.id = proa.product_id and p.space_id = p_space_id
      join public.trials t on t.product_id = p.id and t.space_id = p_space_id
      left join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
      where proa.roa_id = r.id
      group by p.id, p.company_id
    )
    select jsonb_build_object(
      'entity', jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation),
      'product_count', (select count(*) from product_rollup where max_rank is not null),
      'secondary_count', (select count(distinct company_id) from product_rollup where max_rank is not null),
      'secondary_label', 'companies',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
          when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          else null
        end from product_rollup where max_rank is not null
      ),
      'products_missing_phase', (select count(*) from product_rollup where max_rank is null)
    ) as entry_obj
  ) as entry_lateral
  where r.space_id = p_space_id;

  return result;
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260412120100_create_landscape_index_by_dimension.sql
git commit -m "feat(db): add landscape index RPCs for company, MOA, ROA dimensions"
```

---

## Task 12: Create Bullseye-by-Company RPC

**Files:**
- Create: `supabase/migrations/20260412120200_create_bullseye_by_company.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260412120200_create_bullseye_by_company.sql`:

```sql
-- migration: 20260412120200_create_bullseye_by_company
-- purpose: create get_bullseye_by_company() which returns the bullseye dataset
--          scoped to a single company. spokes are therapeutic areas the company
--          operates in. each product appears in its TA spoke.
-- affected objects: public.get_bullseye_by_company (function)

create or replace function public.get_bullseye_by_company(
  p_space_id uuid,
  p_company_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_scope jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', null)
  into v_scope
  from public.companies c
  where c.id = p_company_id and c.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'company', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Therapeutic Areas'
    );
  end if;

  with product_rollup as (
    select
      p.id as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      t.therapeutic_area_id,
      max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.products p
    join public.trials t on t.product_id = p.id and t.space_id = p_space_id
    join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
    where p.space_id = p_space_id and p.company_id = p_company_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id, t.therapeutic_area_id
    having max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  ta_rank as (
    select therapeutic_area_id, max(max_rank) as ta_max_rank
    from product_rollup
    group by therapeutic_area_id
  )
  select coalesce(jsonb_agg(spoke_obj order by tr.ta_max_rank desc, ta.name), '[]'::jsonb)
  into v_spokes
  from public.therapeutic_areas ta
  join ta_rank tr on tr.therapeutic_area_id = ta.id
  cross join lateral (
    select jsonb_build_object(
      'id', ta.id,
      'name', ta.name,
      'display_order', 0,
      'highest_phase_rank', tr.ta_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id', pr.product_id,
            'name', pr.product_name,
            'generic_name', pr.generic_name,
            'logo_url', pr.logo_url,
            'company_id', pr.company_id,
            'company_name', (select c2.name from public.companies c2 where c2.id = pr.company_id),
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action m on m.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id, 'name', t.name, 'identifier', t.identifier,
                  'sample_size', t.sample_size, 'status', t.status,
                  'recruitment_status', t.recruitment_status, 'study_type', t.study_type,
                  'phase', (
                    select tp2.phase_type from public.trial_phases tp2
                    where tp2.trial_id = t.id and tp2.space_id = p_space_id
                    order by case tp2.phase_type
                      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
                      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
                      else -1 end desc, tp2.start_date desc limit 1
                  )
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id
                and t.therapeutic_area_id = pr.therapeutic_area_id
                and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', tmm.id, 'event_date', tmm.event_date,
                  'marker_type_name', mt.name, 'icon', mt.icon,
                  'shape', mt.shape, 'color', mt.color
                ) order by tmm.event_date desc
              ), '[]'::jsonb)
              from (
                select tm.id, tm.event_date, tm.marker_type_id
                from public.trial_markers tm
                join public.trials t2 on t2.id = tm.trial_id
                where t2.product_id = pr.product_id
                  and t2.therapeutic_area_id = pr.therapeutic_area_id
                  and t2.space_id = p_space_id
                  and tm.space_id = p_space_id
                order by tm.event_date desc limit 3
              ) tmm
              join public.marker_types mt on mt.id = tmm.marker_type_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.therapeutic_area_id = ta.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where ta.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'company',
    'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Therapeutic Areas'
  );
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260412120200_create_bullseye_by_company.sql
git commit -m "feat(db): add get_bullseye_by_company RPC"
```

---

## Task 13: Create Bullseye-by-MOA RPC

**Files:**
- Create: `supabase/migrations/20260412120300_create_bullseye_by_moa.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260412120300_create_bullseye_by_moa.sql`:

```sql
-- migration: 20260412120300_create_bullseye_by_moa
-- purpose: create get_bullseye_by_moa() which returns the bullseye dataset
--          scoped to a single mechanism of action. spokes are companies
--          that have products with this MOA.
-- affected objects: public.get_bullseye_by_moa (function)

create or replace function public.get_bullseye_by_moa(
  p_space_id uuid,
  p_moa_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_scope jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', null)
  into v_scope
  from public.mechanisms_of_action m
  where m.id = p_moa_id and m.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'moa', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.product_mechanisms_of_action pmoa
    join public.products p on p.id = pmoa.product_id and p.space_id = p_space_id
    join public.trials t on t.product_id = p.id and t.space_id = p_space_id
    join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
    where pmoa.moa_id = p_moa_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id
    having max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id', pr.product_id,
            'name', pr.product_name,
            'generic_name', pr.generic_name,
            'logo_url', pr.logo_url,
            'company_id', pr.company_id,
            'company_name', c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', mm.id, 'name', mm.name) order by mm.display_order, mm.name)
              from public.product_mechanisms_of_action pmoa2
              join public.mechanisms_of_action mm on mm.id = pmoa2.moa_id
              where pmoa2.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id, 'name', t.name, 'identifier', t.identifier,
                  'sample_size', t.sample_size, 'status', t.status,
                  'recruitment_status', t.recruitment_status, 'study_type', t.study_type,
                  'phase', (
                    select tp2.phase_type from public.trial_phases tp2
                    where tp2.trial_id = t.id and tp2.space_id = p_space_id
                    order by case tp2.phase_type
                      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
                      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
                      else -1 end desc, tp2.start_date desc limit 1
                  )
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', tmm.id, 'event_date', tmm.event_date,
                  'marker_type_name', mt.name, 'icon', mt.icon,
                  'shape', mt.shape, 'color', mt.color
                ) order by tmm.event_date desc
              ), '[]'::jsonb)
              from (
                select tm.id, tm.event_date, tm.marker_type_id
                from public.trial_markers tm
                join public.trials t2 on t2.id = tm.trial_id
                where t2.product_id = pr.product_id and t2.space_id = p_space_id and tm.space_id = p_space_id
                order by tm.event_date desc limit 3
              ) tmm
              join public.marker_types mt on mt.id = tmm.marker_type_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'moa',
    'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260412120300_create_bullseye_by_moa.sql
git commit -m "feat(db): add get_bullseye_by_moa RPC"
```

---

## Task 14: Create Bullseye-by-ROA RPC

**Files:**
- Create: `supabase/migrations/20260412120400_create_bullseye_by_roa.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260412120400_create_bullseye_by_roa.sql`. This is identical to the MOA version but joins on `product_routes_of_administration` and `routes_of_administration` instead:

```sql
-- migration: 20260412120400_create_bullseye_by_roa
-- purpose: create get_bullseye_by_roa() which returns the bullseye dataset
--          scoped to a single route of administration. spokes are companies
--          that have products with this ROA.
-- affected objects: public.get_bullseye_by_roa (function)

create or replace function public.get_bullseye_by_roa(
  p_space_id uuid,
  p_roa_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_scope jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
  into v_scope
  from public.routes_of_administration r
  where r.id = p_roa_id and r.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'roa', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.product_routes_of_administration proa
    join public.products p on p.id = proa.product_id and p.space_id = p_space_id
    join public.trials t on t.product_id = p.id and t.space_id = p_space_id
    join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
    where proa.roa_id = p_roa_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id
    having max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id', pr.product_id,
            'name', pr.product_name,
            'generic_name', pr.generic_name,
            'logo_url', pr.logo_url,
            'company_id', pr.company_id,
            'company_name', c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', mm.id, 'name', mm.name) order by mm.display_order, mm.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action mm on mm.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', rr.id, 'name', rr.name, 'abbreviation', rr.abbreviation) order by rr.display_order, rr.name)
              from public.product_routes_of_administration proa2
              join public.routes_of_administration rr on rr.id = proa2.roa_id
              where proa2.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id, 'name', t.name, 'identifier', t.identifier,
                  'sample_size', t.sample_size, 'status', t.status,
                  'recruitment_status', t.recruitment_status, 'study_type', t.study_type,
                  'phase', (
                    select tp2.phase_type from public.trial_phases tp2
                    where tp2.trial_id = t.id and tp2.space_id = p_space_id
                    order by case tp2.phase_type
                      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
                      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
                      else -1 end desc, tp2.start_date desc limit 1
                  )
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', tmm.id, 'event_date', tmm.event_date,
                  'marker_type_name', mt.name, 'icon', mt.icon,
                  'shape', mt.shape, 'color', mt.color
                ) order by tmm.event_date desc
              ), '[]'::jsonb)
              from (
                select tm.id, tm.event_date, tm.marker_type_id
                from public.trial_markers tm
                join public.trials t2 on t2.id = tm.trial_id
                where t2.product_id = pr.product_id and t2.space_id = p_space_id and tm.space_id = p_space_id
                order by tm.event_date desc limit 3
              ) tmm
              join public.marker_types mt on mt.id = tmm.marker_type_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'roa',
    'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260412120400_create_bullseye_by_roa.sql
git commit -m "feat(db): add get_bullseye_by_roa RPC"
```

---

## Task 15: Final Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

Run: `cd src/client && ng lint 2>&1 | tail -20`

Expected: No errors.

- [ ] **Step 2: Run build**

Run: `cd src/client && ng build 2>&1 | tail -20`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify no stale references to old types**

Run these greps to confirm no old type names remain:

```bash
grep -r 'BullseyeCompany' src/client/src/app/ --include='*.ts' --include='*.html'
grep -r 'therapeutic_area' src/client/src/app/ --include='*.ts' --include='*.html'
grep -r 'companyAngle\|companyLabelTransform\|CompanyLabelTransform' src/client/src/app/ --include='*.ts' --include='*.html'
grep -r 'company_count' src/client/src/app/ --include='*.ts' --include='*.html'
```

Expected: No matches for any of these patterns.

- [ ] **Step 4: Commit (if any fixups needed)**

Only commit if Step 3 revealed stale references that needed fixing.
