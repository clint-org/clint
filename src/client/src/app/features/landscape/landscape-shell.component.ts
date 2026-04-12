import { Component, computed, inject, OnInit, resource, signal } from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
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
  COUNT_UNIT_OPTIONS,
  DIMENSION_OPTIONS,
  dimensionToSegment,
  LandscapeIndexEntry,
  POSITIONING_GROUPING_OPTIONS,
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

        @if (viewMode() === 'positioning') {
          <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
          <p-select
            [options]="groupingOptions"
            [ngModel]="state.positioningGrouping()"
            (ngModelChange)="state.positioningGrouping.set($event)"
            optionLabel="label"
            optionValue="value"
            [style]="{ minWidth: '14rem' }"
            size="small"
          />
          <p-selectbutton
            [options]="countUnitOptions"
            [ngModel]="state.countUnit()"
            (ngModelChange)="state.countUnit.set($event)"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
            size="small"
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
  readonly groupingOptions = POSITIONING_GROUPING_OPTIONS;
  readonly countUnitOptions = COUNT_UNIT_OPTIONS;

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
    } else if (mode === 'positioning') {
      this.router.navigate([...this.spaceBase(), 'positioning']);
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

    if (allSegments.includes('positioning')) {
      this.viewMode.set('positioning');
      this.entityId.set(null);
    } else if (dimSegment) {
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
