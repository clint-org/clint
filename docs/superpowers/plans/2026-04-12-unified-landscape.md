# Unified Landscape Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Dashboard (timeline) and Landscape (bullseye) into a single "Landscape" module with a segmented control for view switching, shared filter state, and new route structure.

**Architecture:** A new `LandscapeShellComponent` owns the toolbar (segmented control, dimension/entity dropdowns) and provides a `LandscapeStateService` that holds shared filter state. Child routes render `TimelineViewComponent` (extracted from the old `DashboardComponent`) or the existing bullseye components. A unified filter bar replaces both the dashboard `FilterPanelComponent` and landscape `LandscapeFilterBarComponent`.

**Tech Stack:** Angular 19 (standalone components, signals, resource), PrimeNG 19 (SelectButton, Select, MultiSelect), Tailwind CSS v4, Supabase RPCs.

**Spec:** `docs/superpowers/specs/2026-04-12-unified-landscape-design.md`

---

### Task 1: Add shared types and create LandscapeStateService

**Files:**
- Modify: `src/client/src/app/core/models/landscape.model.ts`
- Create: `src/client/src/app/features/landscape/landscape-state.service.ts`

- [ ] **Step 1: Add ViewMode type and dimension helpers to landscape.model.ts**

Add these exports at the bottom of `src/client/src/app/core/models/landscape.model.ts` (after the `LandscapeIndexEntry` interface):

```typescript
export type ViewMode = 'timeline' | 'bullseye';

export const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
  { label: 'Timeline', value: 'timeline' },
  { label: 'Bullseye', value: 'bullseye' },
];

export const DIMENSION_OPTIONS: { label: string; value: BullseyeDimension }[] = [
  { label: 'Therapy Area', value: 'therapeutic-area' },
  { label: 'Company', value: 'company' },
  { label: 'Mechanism of Action', value: 'moa' },
  { label: 'Route of Administration', value: 'roa' },
];

export function dimensionToSegment(dim: BullseyeDimension): string {
  const map: Record<BullseyeDimension, string> = {
    'therapeutic-area': 'by-therapy-area',
    company: 'by-company',
    moa: 'by-moa',
    roa: 'by-roa',
  };
  return map[dim];
}

export function segmentToDimension(segment: string): BullseyeDimension {
  const map: Record<string, BullseyeDimension> = {
    'by-therapy-area': 'therapeutic-area',
    'by-company': 'company',
    'by-moa': 'moa',
    'by-roa': 'roa',
  };
  return map[segment] ?? 'therapeutic-area';
}
```

- [ ] **Step 2: Add therapeuticAreaIds to LandscapeFilters**

In the same file, update the `LandscapeFilters` interface and `EMPTY_LANDSCAPE_FILTERS` to include `therapeuticAreaIds`:

Change the `LandscapeFilters` interface to:

```typescript
export interface LandscapeFilters {
  companyIds: string[];
  productIds: string[];
  therapeuticAreaIds: string[];
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
  phases: RingPhase[];
  recruitmentStatuses: string[];
  studyTypes: string[];
}
```

Change `EMPTY_LANDSCAPE_FILTERS` to:

```typescript
export const EMPTY_LANDSCAPE_FILTERS: LandscapeFilters = {
  companyIds: [],
  productIds: [],
  therapeuticAreaIds: [],
  mechanismOfActionIds: [],
  routeOfAdministrationIds: [],
  phases: [],
  recruitmentStatuses: [],
  studyTypes: [],
};
```

- [ ] **Step 3: Create LandscapeStateService**

Create `src/client/src/app/features/landscape/landscape-state.service.ts`:

```typescript
import { Injectable, signal } from '@angular/core';

import {
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  SpokeMode,
} from '../../core/models/landscape.model';
import { ZoomLevel } from '../../core/models/dashboard.model';

/**
 * Shared state for the unified Landscape module.
 * Provided by LandscapeShellComponent so all child views share one instance.
 */
@Injectable()
export class LandscapeStateService {
  /** Shared data filters (persist across view switches). */
  readonly filters = signal<LandscapeFilters>({ ...EMPTY_LANDSCAPE_FILTERS });

  /** Timeline-specific: zoom granularity. */
  readonly zoomLevel = signal<ZoomLevel>('yearly');

  /** Bullseye-specific: spoke grouping mode. */
  readonly spokeMode = signal<SpokeMode>('grouped');
}
```

- [ ] **Step 4: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds. The new types/service are unused but should compile clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts src/client/src/app/features/landscape/landscape-state.service.ts
git commit -m "feat(landscape): add shared types, dimension helpers, and LandscapeStateService"
```

---

### Task 2: Create TimelineViewComponent

**Files:**
- Create: `src/client/src/app/features/landscape/timeline-view.component.ts`
- Create: `src/client/src/app/features/landscape/timeline-view.component.html`

This component extracts the grid/visualization logic from `DashboardComponent`. It reads shared filters from `LandscapeStateService` and owns timeline-specific state (zoom, year range, export dialog).

- [ ] **Step 1: Create timeline-view.component.ts**

Create `src/client/src/app/features/landscape/timeline-view.component.ts`:

```typescript
import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Tooltip } from 'primeng/tooltip';

import { DashboardFilters } from '../../core/models/dashboard.model';
import { TrialMarker } from '../../core/models/marker.model';
import { Trial, TrialPhase } from '../../core/models/trial.model';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardGridComponent } from '../dashboard/grid/dashboard-grid.component';
import { ExportDialogComponent } from '../dashboard/export-dialog/export-dialog.component';
import { LegendComponent } from '../dashboard/legend/legend.component';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-timeline-view',
  standalone: true,
  imports: [
    DashboardGridComponent,
    ExportDialogComponent,
    LegendComponent,
    ButtonModule,
    MessageModule,
    ProgressSpinner,
    Tooltip,
  ],
  templateUrl: './timeline-view.component.html',
})
export class TimelineViewComponent {
  private readonly dashboardService = inject(DashboardService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly startYear = signal(2016);
  readonly endYear = signal(2026);
  readonly exportDialogOpen = signal(false);

  private seeded = false;

  /** Build DashboardFilters from shared LandscapeFilters + year range. */
  private readonly dashboardFilters = computed<DashboardFilters>(() => {
    const f = this.state.filters();
    return {
      companyIds: f.companyIds.length ? f.companyIds : null,
      productIds: f.productIds.length ? f.productIds : null,
      therapeuticAreaIds: f.therapeuticAreaIds.length ? f.therapeuticAreaIds : null,
      mechanismOfActionIds: f.mechanismOfActionIds.length ? f.mechanismOfActionIds : null,
      routeOfAdministrationIds: f.routeOfAdministrationIds.length ? f.routeOfAdministrationIds : null,
      recruitmentStatuses: f.recruitmentStatuses.length ? f.recruitmentStatuses : null,
      studyTypes: f.studyTypes.length ? f.studyTypes : null,
      phases: f.phases.length ? (f.phases as string[]) : null,
      startYear: null,
      endYear: null,
    };
  });

  readonly dashboardData = resource({
    request: () => ({
      filters: this.dashboardFilters(),
      spaceId: this.spaceId(),
    }),
    loader: async ({ request }) => {
      if (!request.spaceId) return { companies: [] };
      const data = await this.dashboardService.getDashboardData(
        request.spaceId,
        request.filters,
      );
      if (!this.seeded && data.companies.length === 0) {
        this.seeded = true;
        await this.dashboardService.seedDemoData(request.spaceId);
        return this.dashboardService.getDashboardData(request.spaceId, request.filters);
      }
      return data;
    },
  });

  readonly companies = computed(() => this.dashboardData.value()?.companies ?? []);

  constructor() {
    // Extract route params from ancestor routes
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }

    // Compute year range from data
    effect(() => {
      const data = this.dashboardData.value();
      if (!data || !data.companies.length) return;

      let minYear = Infinity;
      let maxYear = -Infinity;

      for (const company of data.companies) {
        for (const product of company.products ?? []) {
          for (const trial of product.trials ?? []) {
            for (const phase of trial.trial_phases ?? []) {
              const sy = new Date(phase.start_date).getFullYear();
              if (sy < minYear) minYear = sy;
              if (phase.end_date) {
                const ey = new Date(phase.end_date).getFullYear();
                if (ey > maxYear) maxYear = ey;
              }
            }
            for (const marker of trial.trial_markers ?? []) {
              const my = new Date(marker.event_date).getFullYear();
              if (my < minYear) minYear = my;
              if (my > maxYear) maxYear = my;
            }
          }
        }
      }

      if (minYear !== Infinity) {
        this.startYear.set(minYear - 1);
        this.endYear.set(Math.max(maxYear + 1, new Date().getFullYear() + 1));
      }
    });
  }

  onPhaseClick(phase: TrialPhase): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', phase.trial_id]);
  }

  onMarkerClick(marker: TrialMarker): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', marker.trial_id]);
  }

  onTrialClick(trial: Trial): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', trial.id]);
  }

  onCompanyClick(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'companies']);
  }

  onProductClick(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'products']);
  }

  retry(): void {
    this.dashboardData.reload();
  }
}
```

- [ ] **Step 2: Create timeline-view.component.html**

Create `src/client/src/app/features/landscape/timeline-view.component.html`:

```html
<div class="flex flex-col h-full">
  <div class="flex-1 overflow-auto px-4 pt-3 pb-0">
    @if (dashboardData.isLoading()) {
      <div class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3">
          <p-progressspinner
            strokeWidth="4"
            [style]="{ width: '2rem', height: '2rem' }"
            aria-label="Loading dashboard data"
          />
          <span class="text-sm text-slate-500">Loading dashboard data...</span>
        </div>
      </div>
    } @else if (dashboardData.error()) {
      <div class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3 text-center max-w-md">
          <p-message severity="error" [closable]="false">
            Failed to load dashboard data: {{ dashboardData.error() }}
          </p-message>
          <p-button label="Retry" severity="primary" size="small" (onClick)="retry()" />
        </div>
      </div>
    } @else if (companies().length > 0) {
      <app-dashboard-grid
        [companies]="companies()"
        [zoomLevel]="state.zoomLevel()"
        [startYear]="startYear()"
        [endYear]="endYear()"
        (phaseClick)="onPhaseClick($event)"
        (markerClick)="onMarkerClick($event)"
        (trialClick)="onTrialClick($event)"
        (companyClick)="onCompanyClick()"
        (productClick)="onProductClick()"
      />
    } @else {
      <div class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3 text-center">
          <p-message severity="info" [closable]="false">
            No clinical trial data to display. Add companies, products, and trials to see them on
            the dashboard.
          </p-message>
        </div>
      </div>
    }
  </div>

  <div class="flex-none">
    <app-legend [spaceId]="spaceId()" />
  </div>
</div>

<app-export-dialog
  [companies]="companies()"
  [startYear]="startYear()"
  [endYear]="endYear()"
  [open]="exportDialogOpen()"
  (closed)="exportDialogOpen.set(false)"
/>
```

- [ ] **Step 3: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds. New component exists but is not routed yet.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/timeline-view.component.ts src/client/src/app/features/landscape/timeline-view.component.html
git commit -m "feat(landscape): create TimelineViewComponent extracted from Dashboard"
```

---

### Task 3: Create new LandscapeShellComponent

**Files:**
- Rewrite: `src/client/src/app/features/landscape/landscape-shell.component.ts`

The current file is 54 lines with a sidebar nav. Replace it entirely with the unified shell that has a segmented control, dimension/entity dropdowns, and provides `LandscapeStateService`.

- [ ] **Step 1: Rewrite landscape-shell.component.ts**

Replace the entire content of `src/client/src/app/features/landscape/landscape-shell.component.ts` with:

```typescript
import { Component, computed, inject, OnInit, resource, signal } from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs';
import { SelectButton } from 'primeng/selectbutton';
import { Select } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';

import {
  BullseyeDimension,
  DIMENSION_OPTIONS,
  dimensionToSegment,
  LandscapeIndexEntry,
  segmentToDimension,
  ViewMode,
  VIEW_MODE_OPTIONS,
} from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { LandscapeStateService } from './landscape-state.service';
import { LandscapeFilterBarComponent } from './landscape-filter-bar.component';

@Component({
  selector: 'app-landscape-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    FormsModule,
    SelectButton,
    Select,
    ButtonModule,
    Tooltip,
    LandscapeFilterBarComponent,
  ],
  providers: [LandscapeStateService],
  template: `
    <div class="flex flex-col h-full">
      <!-- Row 1: View controls -->
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 bg-white">
        <p-selectbutton
          [options]="viewModeOptions"
          [ngModel]="viewMode()"
          (ngModelChange)="onViewModeChange($event)"
          optionLabel="label"
          optionValue="value"
          [allowEmpty]="false"
          size="small"
        />

        @if (viewMode() === 'bullseye') {
          <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
          <p-select
            [options]="dimensionOptions"
            [ngModel]="dimension()"
            (ngModelChange)="onDimensionChange($event)"
            optionLabel="label"
            optionValue="value"
            [style]="{ minWidth: '12rem' }"
            size="small"
          />
        }

        @if (viewMode() === 'bullseye' && entityId()) {
          <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
          <p-select
            [options]="entityOptions()"
            [ngModel]="entityId()"
            (ngModelChange)="onEntityChange($event)"
            optionLabel="label"
            optionValue="value"
            [showClear]="true"
            [style]="{ minWidth: '12rem' }"
            size="small"
            placeholder="Select entity"
          />
        }

        <div class="flex-1"></div>

        @if (viewMode() === 'timeline') {
          <p-button
            icon="fa-solid fa-file-powerpoint"
            severity="secondary"
            [text]="true"
            size="small"
            (onClick)="onExportClick()"
            pTooltip="Export to PowerPoint"
            tooltipPosition="bottom"
          />
        }
      </div>

      <!-- Row 2: Filters -->
      <app-landscape-filter-bar
        [spaceId]="spaceId()"
        [viewMode]="viewMode()"
        [dimension]="dimension()"
      />

      <!-- Content -->
      <div class="flex-1 overflow-hidden">
        <router-outlet />
      </div>
    </div>
  `,
})
export class LandscapeShellComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly landscapeService = inject(LandscapeService);
  readonly state = inject(LandscapeStateService);

  readonly viewModeOptions = VIEW_MODE_OPTIONS;
  readonly dimensionOptions = DIMENSION_OPTIONS;

  readonly viewMode = signal<ViewMode>('timeline');
  readonly dimension = signal<BullseyeDimension>('therapeutic-area');
  readonly entityId = signal<string | null>(null);
  readonly tenantId = signal('');
  readonly spaceId = signal('');

  /** Load entity index for the entity dropdown. */
  readonly entityIndex = resource({
    request: () => ({
      spaceId: this.spaceId(),
      dimension: this.dimension(),
      active: this.viewMode() === 'bullseye',
    }),
    loader: async ({ request }) => {
      if (!request.spaceId || !request.active) return [];
      return this.landscapeService.getLandscapeIndex(request.spaceId, request.dimension);
    },
  });

  readonly entityOptions = computed(() =>
    (this.entityIndex.value() ?? []).map((e: LandscapeIndexEntry) => ({
      label: e.entity.name,
      value: e.entity.id,
    })),
  );

  ngOnInit(): void {
    this.extractRouteParams();
    this.syncStateFromUrl();

    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.extractRouteParams();
        this.syncStateFromUrl();
      });

    // Seed filters from query params (deep links from bullseye "Open in Timeline")
    const qp = this.route.snapshot.queryParamMap;
    const productIds = this.parseIdList(qp.get('productIds'));
    const therapeuticAreaIds = this.parseIdList(qp.get('therapeuticAreaIds'));
    if (productIds || therapeuticAreaIds) {
      this.state.filters.update((f) => ({
        ...f,
        productIds: productIds ?? f.productIds,
        therapeuticAreaIds: therapeuticAreaIds ?? f.therapeuticAreaIds,
      }));
    }
  }

  onViewModeChange(mode: ViewMode): void {
    if (mode === 'timeline') {
      this.router.navigate(this.spaceBase());
    } else {
      this.router.navigate([...this.spaceBase(), 'bullseye']);
    }
  }

  onDimensionChange(dim: BullseyeDimension): void {
    this.router.navigate([...this.spaceBase(), 'bullseye', dimensionToSegment(dim)]);
  }

  onEntityChange(entityId: string | null): void {
    if (entityId) {
      this.router.navigate([
        ...this.spaceBase(),
        'bullseye',
        dimensionToSegment(this.dimension()),
        entityId,
      ]);
    } else {
      this.router.navigate([
        ...this.spaceBase(),
        'bullseye',
        dimensionToSegment(this.dimension()),
      ]);
    }
  }

  onExportClick(): void {
    // Broadcast to TimelineViewComponent via the DOM — the timeline listens
    // for this custom event on its host. This avoids coupling the shell to
    // the timeline's internal export dialog state.
    document.dispatchEvent(new CustomEvent('landscape:export'));
  }

  private spaceBase(): string[] {
    return ['/t', this.tenantId(), 's', this.spaceId()];
  }

  private extractRouteParams(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }
  }

  private syncStateFromUrl(): void {
    let child = this.route.firstChild;
    while (child?.firstChild) child = child.firstChild;

    if (!child) {
      this.viewMode.set('timeline');
      this.entityId.set(null);
      return;
    }

    const segments = child.snapshot.url.map((s) => s.path);
    const parentSegments = child.snapshot.parent?.url.map((s) => s.path) ?? [];
    const allSegments = [...parentSegments, ...segments];

    const dimSegment = allSegments.find((s) =>
      ['by-therapy-area', 'by-company', 'by-moa', 'by-roa'].includes(s),
    );

    if (dimSegment) {
      this.viewMode.set('bullseye');
      this.dimension.set(segmentToDimension(dimSegment));
      this.entityId.set(child.snapshot.paramMap.get('entityId'));
    } else if (allSegments.includes('bullseye')) {
      this.viewMode.set('bullseye');
      this.entityId.set(null);
    } else {
      this.viewMode.set('timeline');
      this.entityId.set(null);
    }
  }

  private parseIdList(value: string | null): string[] | null {
    if (!value) return null;
    const ids = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    return ids.length > 0 ? ids : null;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -10`
Expected: May warn about unused imports or the filter bar's changed API. Note any errors for the next task.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-shell.component.ts
git commit -m "feat(landscape): rewrite shell with segmented control and dimension dropdowns"
```

---

### Task 4: Unify the filter bar

**Files:**
- Rewrite: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`
- Rewrite: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`

Merge the dashboard `FilterPanelComponent` and landscape `LandscapeFilterBarComponent` into a single unified component. It loads all options from services (like the dashboard filter panel), reads/writes `LandscapeStateService.filters`, and conditionally shows zoom (timeline) and spoke mode (bullseye).

- [ ] **Step 1: Rewrite landscape-filter-bar.component.ts**

Replace the entire content of `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`:

```typescript
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelect } from 'primeng/multiselect';
import { SelectButton } from 'primeng/selectbutton';
import { ProgressSpinner } from 'primeng/progressspinner';

import {
  BullseyeDimension,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  RingPhase,
  ViewMode,
} from '../../core/models/landscape.model';
import { ZoomLevel } from '../../core/models/dashboard.model';
import { CompanyService } from '../../core/services/company.service';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { ProductService } from '../../core/services/product.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';
import { TherapeuticAreaService } from '../../core/services/therapeutic-area.service';
import { LandscapeStateService } from './landscape-state.service';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-landscape-filter-bar',
  standalone: true,
  imports: [FormsModule, MultiSelect, ButtonModule, SelectButton, ProgressSpinner],
  templateUrl: './landscape-filter-bar.component.html',
})
export class LandscapeFilterBarComponent implements OnInit {
  private readonly companyService = inject(CompanyService);
  private readonly productService = inject(ProductService);
  private readonly taService = inject(TherapeuticAreaService);
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);
  readonly state = inject(LandscapeStateService);

  readonly spaceId = input.required<string>();
  readonly viewMode = input<ViewMode>('timeline');
  readonly dimension = input<BullseyeDimension>('therapeutic-area');

  readonly loading = signal(true);
  readonly companyOptions = signal<SelectOption[]>([]);
  readonly productOptions = signal<SelectOption[]>([]);
  readonly taOptions = signal<SelectOption[]>([]);
  readonly moaOptions = signal<SelectOption[]>([]);
  readonly roaOptions = signal<SelectOption[]>([]);

  readonly zoomOptions: { label: string; value: ZoomLevel }[] = [
    { label: 'Y', value: 'yearly' },
    { label: 'Q', value: 'quarterly' },
    { label: 'M', value: 'monthly' },
    { label: 'D', value: 'daily' },
  ];

  readonly spokeModeOptions: { label: string; value: string }[] = [
    { label: 'Grouped', value: 'grouped' },
    { label: 'Products', value: 'products' },
  ];

  readonly phaseOptions: { label: string; value: RingPhase }[] = [
    { label: 'P1', value: 'P1' },
    { label: 'P2', value: 'P2' },
    { label: 'P3', value: 'P3' },
    { label: 'Appr', value: 'APPROVED' },
  ];

  readonly statusOptions: SelectOption[] = [
    { label: 'Not yet recruiting', value: 'Not yet recruiting' },
    { label: 'Recruiting', value: 'Recruiting' },
    { label: 'Active, not recruiting', value: 'Active, not recruiting' },
    { label: 'Completed', value: 'Completed' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Terminated', value: 'Terminated' },
    { label: 'Withdrawn', value: 'Withdrawn' },
  ];

  readonly studyTypeOptions: SelectOption[] = [
    { label: 'Interventional', value: 'Interventional' },
    { label: 'Observational', value: 'Observational' },
    { label: 'Expanded Access', value: 'Expanded Access' },
  ];

  readonly hasAnyActive = computed(() => {
    const f = this.state.filters();
    return (
      f.companyIds.length > 0 ||
      f.productIds.length > 0 ||
      f.therapeuticAreaIds.length > 0 ||
      f.mechanismOfActionIds.length > 0 ||
      f.routeOfAdministrationIds.length > 0 ||
      f.phases.length > 0 ||
      f.recruitmentStatuses.length > 0 ||
      f.studyTypes.length > 0
    );
  });

  async ngOnInit(): Promise<void> {
    const sid = this.spaceId();
    if (!sid) {
      this.loading.set(false);
      return;
    }
    try {
      const [companies, products, areas, moas, roas] = await Promise.all([
        this.companyService.list(sid),
        this.productService.list(sid),
        this.taService.list(sid),
        this.moaService.list(sid),
        this.roaService.list(sid),
      ]);
      this.companyOptions.set(companies.map((c) => ({ label: c.name, value: c.id })));
      this.productOptions.set(products.map((p) => ({ label: p.name, value: p.id })));
      this.taOptions.set(areas.map((a) => ({ label: a.name, value: a.id })));
      this.moaOptions.set(moas.map((m) => ({ label: m.name, value: m.id })));
      this.roaOptions.set(roas.map((r) => ({ label: r.name, value: r.id })));
    } finally {
      this.loading.set(false);
    }
  }

  update<K extends keyof LandscapeFilters>(key: K, value: LandscapeFilters[K]): void {
    const safe = value ?? ([] as unknown as LandscapeFilters[K]);
    this.state.filters.update((f) => ({ ...f, [key]: safe }));
  }

  clearAll(): void {
    this.state.filters.set({ ...EMPTY_LANDSCAPE_FILTERS });
  }
}
```

- [ ] **Step 2: Rewrite landscape-filter-bar.component.html**

Replace the entire content of `src/client/src/app/features/landscape/landscape-filter-bar.component.html`:

```html
<div
  class="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-slate-200 bg-white"
  role="toolbar"
  aria-label="Landscape filters"
>
  @if (loading()) {
    <div class="flex items-center gap-2">
      <p-progressspinner
        strokeWidth="4"
        [style]="{ width: '0.875rem', height: '0.875rem' }"
        aria-hidden="true"
      />
      <span class="text-xs text-slate-400" aria-live="polite">Loading filters...</span>
    </div>
  } @else {
    <!-- View-specific: zoom (timeline) -->
    @if (viewMode() === 'timeline') {
      <p-selectbutton
        [options]="zoomOptions"
        [ngModel]="state.zoomLevel()"
        (ngModelChange)="state.zoomLevel.set($event)"
        optionLabel="label"
        optionValue="value"
        [allowEmpty]="false"
        size="small"
      />
      <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
    }

    <!-- View-specific: spoke mode (bullseye) -->
    @if (viewMode() === 'bullseye') {
      <p-selectbutton
        [options]="spokeModeOptions"
        [ngModel]="state.spokeMode()"
        (ngModelChange)="state.spokeMode.set($event)"
        optionLabel="label"
        optionValue="value"
        [allowEmpty]="false"
        size="small"
      />
      <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
    }

    <!-- Common filters -->
    @if (viewMode() !== 'bullseye' || dimension() !== 'company') {
      <p-multiselect
        [options]="companyOptions()"
        [ngModel]="state.filters().companyIds"
        (ngModelChange)="update('companyIds', $event)"
        placeholder="Company"
        ariaLabel="Filter by company"
        optionLabel="label"
        optionValue="value"
        display="comma"
        [filter]="true"
        [showClear]="true"
        styleClass="w-32"
        size="small"
      />
    }

    <p-multiselect
      [options]="productOptions()"
      [ngModel]="state.filters().productIds"
      (ngModelChange)="update('productIds', $event)"
      placeholder="Product"
      ariaLabel="Filter by product"
      optionLabel="label"
      optionValue="value"
      display="comma"
      [filter]="true"
      [showClear]="true"
      styleClass="w-32"
      size="small"
    />

    @if (viewMode() !== 'bullseye' || dimension() !== 'therapeutic-area') {
      <p-multiselect
        [options]="taOptions()"
        [ngModel]="state.filters().therapeuticAreaIds"
        (ngModelChange)="update('therapeuticAreaIds', $event)"
        placeholder="Therapy Area"
        ariaLabel="Filter by therapeutic area"
        optionLabel="label"
        optionValue="value"
        display="comma"
        [filter]="true"
        [showClear]="true"
        styleClass="w-36"
        size="small"
      />
    }

    @if (viewMode() !== 'bullseye' || dimension() !== 'moa') {
      <p-multiselect
        [options]="moaOptions()"
        [ngModel]="state.filters().mechanismOfActionIds"
        (ngModelChange)="update('mechanismOfActionIds', $event)"
        placeholder="MOA"
        ariaLabel="Filter by mechanism of action"
        optionLabel="label"
        optionValue="value"
        display="comma"
        [filter]="true"
        [showClear]="true"
        styleClass="w-32"
        size="small"
      />
    }

    @if (viewMode() !== 'bullseye' || dimension() !== 'roa') {
      <p-multiselect
        [options]="roaOptions()"
        [ngModel]="state.filters().routeOfAdministrationIds"
        (ngModelChange)="update('routeOfAdministrationIds', $event)"
        placeholder="ROA"
        ariaLabel="Filter by route of administration"
        optionLabel="label"
        optionValue="value"
        display="comma"
        [filter]="true"
        [showClear]="true"
        styleClass="w-32"
        size="small"
      />
    }

    <p-selectbutton
      [options]="phaseOptions"
      [ngModel]="state.filters().phases"
      (ngModelChange)="update('phases', $event)"
      [multiple]="true"
      optionLabel="label"
      optionValue="value"
      size="small"
    />

    <p-multiselect
      [options]="statusOptions"
      [ngModel]="state.filters().recruitmentStatuses"
      (ngModelChange)="update('recruitmentStatuses', $event)"
      placeholder="Status"
      ariaLabel="Filter by recruitment status"
      optionLabel="label"
      optionValue="value"
      display="comma"
      [showClear]="true"
      styleClass="w-28"
      size="small"
    />

    <p-multiselect
      [options]="studyTypeOptions"
      [ngModel]="state.filters().studyTypes"
      (ngModelChange)="update('studyTypes', $event)"
      placeholder="Study type"
      ariaLabel="Filter by study type"
      optionLabel="label"
      optionValue="value"
      display="comma"
      [showClear]="true"
      styleClass="w-28"
      size="small"
    />

    @if (hasAnyActive()) {
      <p-button
        label="Clear"
        severity="secondary"
        [text]="true"
        size="small"
        (onClick)="clearAll()"
      />
    }
  }
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-filter-bar.component.ts src/client/src/app/features/landscape/landscape-filter-bar.component.html
git commit -m "feat(landscape): unify filter bar with shared state, zoom, and spoke mode"
```

---

### Task 5: Refactor bullseye components for shell integration

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape.component.html`
- Modify: `src/client/src/app/features/landscape/landscape-index.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-index.component.html`

Remove the filter bar and header bar from the bullseye component (now handled by the shell). Read filters and spoke mode from `LandscapeStateService`.

- [ ] **Step 1: Refactor landscape.component.ts**

In `src/client/src/app/features/landscape/landscape.component.ts`, make these changes:

1. Add `LandscapeStateService` import and inject it.
2. Remove: `landscapeFilters` signal, `spokeMode` signal (use state service instead).
3. Remove: `LandscapeFilterBarComponent` from imports array.
4. Remove: `FormsModule`, `SelectButton` from imports (spoke mode moved to filter bar).
5. Update `matchedProductIds` to read from `state.filters()`.
6. Update `chartData` to read from `state.spokeMode()`.
7. Update `spokeModeOptions` to read from `state.spokeMode()`.
8. Remove: `onLandscapeFiltersChange` method.
9. Update `onOpenInTimeline` to navigate to shell root (no `/landscape` prefix).

Replace the entire file content:

```typescript
import { Component, computed, effect, HostListener, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import {
  BullseyeDimension,
  BullseyeProduct,
  BullseyeSpoke,
  LandscapeFilters,
  RingPhase,
  segmentToDimension,
} from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { BullseyeChartComponent } from './bullseye-chart.component';
import { BullseyeDetailPanelComponent } from './bullseye-detail-panel.component';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-landscape',
  standalone: true,
  imports: [
    BullseyeChartComponent,
    BullseyeDetailPanelComponent,
    RouterLink,
    ButtonModule,
    MessageModule,
    ProgressSpinner,
  ],
  templateUrl: './landscape.component.html',
})
export class LandscapeComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly entityId = signal('');
  readonly dimension = signal<BullseyeDimension>('therapeutic-area');

  readonly selectedProductId = signal<string | null>(null);
  readonly hoveredProductId = signal<string | null>(null);
  readonly highlightedRing = signal<RingPhase | null>(null);

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
        request.entityId,
      );
    },
  });

  readonly allProducts = computed<BullseyeProduct[]>(() =>
    this.bullseyeData.value()?.spokes.flatMap((s) => s.products) ?? [],
  );

  readonly chartData = computed(() => {
    const data = this.bullseyeData.value();
    if (!data) return null;
    if (this.state.spokeMode() === 'grouped') return data;

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

  readonly selectedProduct = computed<BullseyeProduct | null>(() => {
    const id = this.selectedProductId();
    if (!id) return null;
    return this.allProducts().find((p) => p.id === id) ?? null;
  });

  readonly matchedProductIds = computed<Set<string> | null>(() => {
    const f = this.state.filters();
    const noneActive =
      f.companyIds.length === 0 &&
      f.productIds.length === 0 &&
      f.therapeuticAreaIds.length === 0 &&
      f.mechanismOfActionIds.length === 0 &&
      f.routeOfAdministrationIds.length === 0 &&
      f.phases.length === 0 &&
      f.recruitmentStatuses.length === 0 &&
      f.studyTypes.length === 0;
    if (noneActive) return null;

    const matched = new Set<string>();
    for (const product of this.allProducts()) {
      if (this.productMatches(product, f)) matched.add(product.id);
    }
    return matched;
  });

  constructor() {
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

  private collectParam(name: string): string {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const val = snap.paramMap.get(name);
      if (val) return val;
      snap = snap.parent;
    }
    return '';
  }

  ngOnInit(): void {
    this.tenantId.set(this.collectParam('tenantId'));
    this.spaceId.set(this.collectParam('spaceId'));
    this.entityId.set(this.collectParam('entityId'));
    this.selectedProductId.set(this.route.snapshot.queryParamMap.get('product'));

    const urlSegments = this.route.snapshot.url;
    const dimensionSegment = urlSegments.find((s) =>
      ['by-therapy-area', 'by-company', 'by-moa', 'by-roa'].includes(s.path),
    );
    if (dimensionSegment) {
      this.dimension.set(segmentToDimension(dimensionSegment.path));
    }

    this.route.paramMap.subscribe(() => {
      this.tenantId.set(this.collectParam('tenantId'));
      this.spaceId.set(this.collectParam('spaceId'));
      this.entityId.set(this.collectParam('entityId'));
    });
    this.route.queryParamMap.subscribe((qp) => {
      this.selectedProductId.set(qp.get('product'));
    });
  }

  onProductHover(productId: string | null): void {
    this.hoveredProductId.set(productId);
  }

  onProductClick(productId: string): void {
    this.selectedProductId.set(productId);
    this.highlightedRing.set(null);
    this.updateQueryParam(productId);
  }

  onBackgroundClick(): void {
    if (this.selectedProductId() !== null) {
      this.selectedProductId.set(null);
      this.updateQueryParam(null);
    }
  }

  onClearSelection(): void {
    this.selectedProductId.set(null);
    this.updateQueryParam(null);
  }

  onRingHighlightToggle(phase: RingPhase | null): void {
    if (this.highlightedRing() === phase) {
      this.highlightedRing.set(null);
    } else {
      this.highlightedRing.set(phase);
    }
  }

  onOpenTrial(trialId: string): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', trialId]);
  }

  onOpenCompany(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'companies']);
  }

  onOpenInTimeline(payload: { productId: string; therapeuticAreaId: string }): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId()], {
      queryParams: {
        productIds: payload.productId,
        therapeuticAreaIds: payload.therapeuticAreaId,
      },
    });
  }

  retry(): void {
    this.bullseyeData.reload();
  }

  private productMatches(product: BullseyeProduct, f: LandscapeFilters): boolean {
    if (f.companyIds.length > 0 && !f.companyIds.includes(product.company_id)) return false;
    if (f.productIds.length > 0 && !f.productIds.includes(product.id)) return false;
    if (f.therapeuticAreaIds.length > 0) return true; // TA filter doesn't apply to product-level matching
    if (f.mechanismOfActionIds.length > 0) {
      const ok = (product.moas ?? []).some((m) => f.mechanismOfActionIds.includes(m.id));
      if (!ok) return false;
    }
    if (f.routeOfAdministrationIds.length > 0) {
      const ok = (product.roas ?? []).some((r) => f.routeOfAdministrationIds.includes(r.id));
      if (!ok) return false;
    }
    if (f.phases.length > 0 && !f.phases.includes(product.highest_phase)) return false;
    if (f.recruitmentStatuses.length > 0) {
      const ok = (product.trials ?? []).some(
        (t) => t.recruitment_status != null && f.recruitmentStatuses.includes(t.recruitment_status),
      );
      if (!ok) return false;
    }
    if (f.studyTypes.length > 0) {
      const ok = (product.trials ?? []).some(
        (t) => t.study_type != null && f.studyTypes.includes(t.study_type),
      );
      if (!ok) return false;
    }
    return true;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectedProductId() !== null) {
      this.onClearSelection();
    }
  }

  private updateQueryParam(productId: string | null): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { product: productId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
```

- [ ] **Step 2: Refactor landscape.component.html**

Replace the entire content of `src/client/src/app/features/landscape/landscape.component.html`. Remove the header bar (scope name + spoke mode toggle) and the filter bar. The shell now handles both.

```html
<div class="flex flex-col h-full">
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
            Failed to load landscape data. Please try again.
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

- [ ] **Step 3: Update landscape-index.component.ts route links**

In `src/client/src/app/features/landscape/landscape-index.component.ts`, the `routeSegment()` method returns a segment used in routerLinks. The index cards currently link to `/landscape/by-therapy-area/:id` etc. Update these to use the new `/bullseye/by-*/:id` pattern.

No changes needed to the TS file itself, but the template links need updating.

- [ ] **Step 4: Update landscape-index.component.html routerLink**

In `src/client/src/app/features/landscape/landscape-index.component.html`, change the routerLink on the card anchor (line 42) from:

```html
[routerLink]="['/t', tenantId(), 's', spaceId(), 'landscape', routeSegment(), entry.entity.id]"
```

to:

```html
[routerLink]="['/t', tenantId(), 's', spaceId(), 'bullseye', routeSegment(), entry.entity.id]"
```

Also remove the header bar at the top of the template (lines 1-4):

```html
<div class="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white">
    <span class="text-sm text-slate-700">{{ dimensionLabel() }}</span>
  </div>
```

The dimension label is now shown by the dimension dropdown in the shell.

The updated template should start directly with the content area:

```html
<div class="flex flex-col h-full">
  <div class="flex-1 overflow-auto p-6">
    @if (indexData.isLoading()) {
```

(removing the `<div class="flex items-center gap-3 ...` block and the extra closing `</div>`)

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/landscape.component.ts src/client/src/app/features/landscape/landscape.component.html src/client/src/app/features/landscape/landscape-index.component.ts src/client/src/app/features/landscape/landscape-index.component.html
git commit -m "refactor(landscape): bullseye components use shared state service, remove filter bar and header"
```

---

### Task 6: Restructure routes and update header

**Files:**
- Modify: `src/client/src/app/app.routes.ts`
- Modify: `src/client/src/app/core/layout/header.component.ts`

- [ ] **Step 1: Rewrite app.routes.ts**

Replace the `s/:spaceId` children block in `src/client/src/app/app.routes.ts`. The new structure:
- Root `''` loads `LandscapeShellComponent` with children:
  - `''` loads `TimelineViewComponent` (default)
  - `bullseye` children: dimension index and detail routes
- Old `landscape/*` routes redirect to `bullseye/*`
- `manage/*` routes stay unchanged

Replace the entire space-scoped children array (lines 38-174) with:

```typescript
        path: 's/:spaceId',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/landscape/landscape-shell.component').then(
                (m) => m.LandscapeShellComponent,
              ),
            children: [
              {
                path: '',
                loadComponent: () =>
                  import('./features/landscape/timeline-view.component').then(
                    (m) => m.TimelineViewComponent,
                  ),
              },
              {
                path: 'bullseye',
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
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-therapy-area/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                  {
                    path: 'by-company',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-company/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                  {
                    path: 'by-moa',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-moa/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                  {
                    path: 'by-roa',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-roa/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                ],
              },
            ],
          },
          // Redirects: old /landscape/* paths → /bullseye/*
          {
            path: 'landscape',
            pathMatch: 'full',
            redirectTo: 'bullseye/by-therapy-area',
          },
          {
            path: 'landscape/by-therapy-area',
            redirectTo: 'bullseye/by-therapy-area',
          },
          {
            path: 'landscape/by-therapy-area/:entityId',
            redirectTo: 'bullseye/by-therapy-area/:entityId',
          },
          {
            path: 'landscape/by-company',
            redirectTo: 'bullseye/by-company',
          },
          {
            path: 'landscape/by-company/:entityId',
            redirectTo: 'bullseye/by-company/:entityId',
          },
          {
            path: 'landscape/by-moa',
            redirectTo: 'bullseye/by-moa',
          },
          {
            path: 'landscape/by-moa/:entityId',
            redirectTo: 'bullseye/by-moa/:entityId',
          },
          {
            path: 'landscape/by-roa',
            redirectTo: 'bullseye/by-roa',
          },
          {
            path: 'landscape/by-roa/:entityId',
            redirectTo: 'bullseye/by-roa/:entityId',
          },
          {
            path: 'landscape/:therapeuticAreaId',
            redirectTo: 'bullseye/by-therapy-area/:therapeuticAreaId',
          },
          // Manage routes (unchanged)
          {
            path: 'manage/companies',
            loadComponent: () =>
              import('./features/manage/companies/company-list.component').then(
                (m) => m.CompanyListComponent,
              ),
          },
          {
            path: 'manage/products',
            loadComponent: () =>
              import('./features/manage/products/product-list.component').then(
                (m) => m.ProductListComponent,
              ),
          },
          {
            path: 'manage/trials',
            loadComponent: () =>
              import('./features/manage/trials/trial-list.component').then(
                (m) => m.TrialListComponent,
              ),
          },
          {
            path: 'manage/trials/:id',
            loadComponent: () =>
              import('./features/manage/trials/trial-detail.component').then(
                (m) => m.TrialDetailComponent,
              ),
          },
          {
            path: 'manage/marker-types',
            loadComponent: () =>
              import('./features/manage/marker-types/marker-type-list.component').then(
                (m) => m.MarkerTypeListComponent,
              ),
          },
          {
            path: 'manage/mechanisms-of-action',
            loadComponent: () =>
              import(
                './features/manage/mechanisms-of-action/mechanism-of-action-list.component'
              ).then((m) => m.MechanismOfActionListComponent),
          },
          {
            path: 'manage/routes-of-administration',
            loadComponent: () =>
              import(
                './features/manage/routes-of-administration/route-of-administration-list.component'
              ).then((m) => m.RouteOfAdministrationListComponent),
          },
          {
            path: 'manage/therapeutic-areas',
            loadComponent: () =>
              import('./features/manage/therapeutic-areas/therapeutic-area-list.component').then(
                (m) => m.TherapeuticAreaListComponent,
              ),
          },
        ],
```

- [ ] **Step 2: Update header navigation**

In `src/client/src/app/core/layout/header.component.ts`, in the inline template, replace the nav section (the `<!-- Center: primary nav -->` block, around lines 78-131).

Remove the "Dashboard" link entirely. Change the "Landscape" link to point to the space root and activate on the root route. The updated nav block:

```html
        @if (spaceId()) {
          <nav class="flex items-center gap-7">
            <a
              [routerLink]="spaceBase()"
              routerLinkActive="nav-active"
              [routerLinkActiveOptions]="{ exact: true }"
              class="nav-link"
            >
              Landscape
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'companies')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Companies
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'products')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Products
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'trials')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Trials
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'marker-types')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Markers
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'therapeutic-areas')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Areas
            </a>
          </nav>
        }
```

Note: The `routerLinkActive` on the Landscape link uses `exact: true` so it doesn't stay active when navigating to manage routes. However, since the shell component is at the root, the nav link will be active for both timeline and bullseye views -- which is correct. If `exact: true` prevents activation on `/bullseye/*` sub-routes, remove the `[routerLinkActiveOptions]` line so it matches on prefix.

Actually, since the Landscape link points to the root `/t/:tenantId/s/:spaceId` which is the shell, and the manage routes are siblings, `routerLinkActive` with the default prefix matching will highlight "Landscape" for all shell routes and the correct manage link for manage routes. But it might also highlight "Landscape" when on manage routes since they share the `/t/:tenantId/s/:spaceId` prefix. To avoid this, keep `{ exact: true }` -- the Landscape link will only be active on the exact root (Timeline view), not bullseye sub-routes. For a better approach, drop `exact: true` and instead add a more specific path check, or just accept the behavior for now and fix in polish.

The safest option: remove `[routerLinkActiveOptions]` entirely. With prefix matching, `Landscape` stays active on `/t/:tid/s/:sid` and `/t/:tid/s/:sid/bullseye/**`. The manage links start with `manage/` so they won't conflict:

```html
            <a
              [routerLink]="spaceBase()"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Landscape
            </a>
```

- [ ] **Step 3: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -20`
Expected: Build succeeds. This is the integration step where everything wires together.

- [ ] **Step 4: Run lint**

Run: `cd src/client && npx ng lint 2>&1 | tail -20`
Expected: Lint passes (or shows only pre-existing warnings).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/app.routes.ts src/client/src/app/core/layout/header.component.ts
git commit -m "feat(landscape): restructure routes under unified shell, update header nav"
```

---

### Task 7: Cleanup and verification

**Files:**
- Delete: `src/client/src/app/features/dashboard/dashboard.component.ts`
- Delete: `src/client/src/app/features/dashboard/dashboard.component.html`
- Delete: `src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts`
- Delete: `src/client/src/app/features/dashboard/filter-panel/filter-panel.component.html`

- [ ] **Step 1: Verify no remaining imports of deleted components**

Search for any imports of the components we're about to delete:

Run: `cd src/client && grep -r "DashboardComponent\|FilterPanelComponent\|filter-panel.component" src/app/ --include="*.ts" | grep -v node_modules`

Expected: Only the files we're about to delete should reference these. If `TimelineViewComponent` or any other file imports `FilterPanelComponent`, fix the import first.

Also check for references to the old dashboard component:

Run: `cd src/client && grep -r "dashboard.component" src/app/ --include="*.ts" | grep -v node_modules`

Expected: No references outside the files being deleted.

- [ ] **Step 2: Delete old dashboard component and filter panel**

```bash
rm src/client/src/app/features/dashboard/dashboard.component.ts
rm src/client/src/app/features/dashboard/dashboard.component.html
rm src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts
rm src/client/src/app/features/dashboard/filter-panel/filter-panel.component.html
```

- [ ] **Step 3: Verify build and lint**

Run: `cd src/client && npx ng lint && npx ng build`
Expected: Both pass cleanly.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old DashboardComponent and FilterPanelComponent"
```

---

### Task 8: Wire export button from shell to TimelineViewComponent

**Files:**
- Modify: `src/client/src/app/features/landscape/timeline-view.component.ts`

The shell dispatches a `landscape:export` custom event when the export button is clicked. The TimelineViewComponent needs to listen for it.

- [ ] **Step 1: Add HostListener for export event**

In `src/client/src/app/features/landscape/timeline-view.component.ts`, add a `HostListener` import and a listener method:

Add to imports: `HostListener` from `@angular/core`.

Add this method to the class:

```typescript
  @HostListener('document:landscape:export')
  onExportRequest(): void {
    if (this.companies().length > 0) {
      this.exportDialogOpen.set(true);
    }
  }
```

Note: `@HostListener` for custom events on `document` may not work. If it doesn't, use an alternative approach in the constructor:

```typescript
// In constructor, after the existing code:
if (typeof document !== 'undefined') {
  document.addEventListener('landscape:export', () => {
    if (this.companies().length > 0) {
      this.exportDialogOpen.set(true);
    }
  });
}
```

For proper cleanup, inject `DestroyRef` and use it:

```typescript
import { Component, computed, DestroyRef, effect, inject, resource, signal } from '@angular/core';
```

Then in constructor:

```typescript
const destroyRef = inject(DestroyRef);
const exportHandler = () => {
  if (this.companies().length > 0) {
    this.exportDialogOpen.set(true);
  }
};
document.addEventListener('landscape:export', exportHandler);
destroyRef.onDestroy(() => document.removeEventListener('landscape:export', exportHandler));
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/timeline-view.component.ts
git commit -m "feat(landscape): wire export button from shell to timeline view"
```

---

### Post-implementation notes

**Things to manually verify in the browser:**
1. Landing on a space URL shows the timeline with the segmented control showing "Timeline" active
2. Clicking "Bullseye" in the segmented control navigates to the bullseye index (by-therapy-area default)
3. Dimension dropdown switches between TA/Company/MOA/ROA index views
4. Selecting an entity card shows the bullseye chart; entity dropdown appears in toolbar
5. Entity dropdown allows switching entities or clearing (returns to index)
6. Filters persist when switching between Timeline and Bullseye
7. Zoom control appears only in Timeline mode; spoke mode appears only in Bullseye mode
8. Old `/landscape/*` URLs redirect to `/bullseye/*`
9. "Open in Timeline" from bullseye detail panel navigates to timeline with pre-filtered data
10. Export button works in timeline view
11. Header shows "Landscape" as the active nav item for both timeline and bullseye views
