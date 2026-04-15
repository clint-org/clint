import {
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  resource,
  signal,
} from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import {
  BullseyeDimension,
  LandscapeIndexEntry,
  dimensionToSegment,
  segmentToDimension,
  groupingToSegment,
  segmentToGrouping,
  POSITIONING_SEGMENTS,
  ViewMode,
} from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { LandscapeStateService } from './landscape-state.service';
import { LandscapeFilterBarComponent } from './landscape-filter-bar.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-landscape-shell',
  standalone: true,
  imports: [RouterOutlet, LandscapeFilterBarComponent],
  providers: [LandscapeStateService],
  template: `
    <div class="flex flex-col h-full">
      <!-- Filters (includes view-specific controls) -->
      <app-landscape-filter-bar
        [spaceId]="spaceId()"
        [viewMode]="viewMode()"
        [dimension]="dimension()"
        [entityId]="entityId()"
        [entityOptions]="entityOptions()"
        (entityChange)="onEntityChange($event)"
      />

      <!-- Content -->
      <div class="flex-1 overflow-hidden">
        <router-outlet />
      </div>
    </div>
  `,
})
export class LandscapeShellComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly landscapeService = inject(LandscapeService);
  readonly state = inject(LandscapeStateService);
  private readonly topbarState = inject(TopbarStateService);

  private readonly exportEffect = effect(() => {
    if (this.viewMode() === 'timeline') {
      this.topbarState.actions.set([
        {
          label: '',
          icon: 'fa-solid fa-file-powerpoint',
          text: true,
          severity: 'secondary',
          callback: () => this.onExportClick(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  /** Push dimension/grouping sub-tabs to the topbar for Bullseye and Positioning views. */
  private readonly subTabEffect = effect(() => {
    const mode = this.viewMode();
    if (mode === 'bullseye') {
      const seg = dimensionToSegment(this.dimension());
      this.topbarState.subTabs.set([
        { label: 'Therapy Area', value: 'by-therapy-area', active: seg === 'by-therapy-area' },
        { label: 'Company', value: 'by-company', active: seg === 'by-company' },
        { label: 'MOA', value: 'by-moa', active: seg === 'by-moa' },
        { label: 'ROA', value: 'by-roa', active: seg === 'by-roa' },
      ]);
    } else if (mode === 'positioning') {
      const seg = groupingToSegment(this.state.positioningGrouping());
      this.topbarState.subTabs.set([
        { label: 'MOA', value: 'by-moa', active: seg === 'by-moa' },
        { label: 'Therapy Area', value: 'by-therapy-area', active: seg === 'by-therapy-area' },
        { label: 'MOA + TA', value: 'by-moa-therapy-area', active: seg === 'by-moa-therapy-area' },
        { label: 'Company', value: 'by-company', active: seg === 'by-company' },
        { label: 'ROA', value: 'by-roa', active: seg === 'by-roa' },
      ]);
    } else {
      this.topbarState.subTabs.set([]);
    }
  });

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
    }))
  );

  ngOnInit(): void {
    this.extractRouteParams();
    this.syncStateFromUrl();

    // Restore persisted landscape state from sessionStorage.
    this.state.init(this.spaceId());

    // Deep-link query params override restored session state
    // (e.g. bullseye "Open in Timeline" links).
    this.applyQueryParamFilters();

    // Sub-tab click handler: navigates for both Bullseye and Positioning.
    this.topbarState.onSubTabClick.set((value: string) => {
      if (this.viewMode() === 'bullseye') {
        this.router.navigate([...this.spaceBase(), 'bullseye', value]);
      } else if (this.viewMode() === 'positioning') {
        this.router.navigate([...this.spaceBase(), 'positioning', value]);
      }
    });

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.extractRouteParams();
      this.syncStateFromUrl();
      this.applyQueryParamFilters();
    });
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
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
      this.router.navigate([...this.spaceBase(), 'bullseye', dimensionToSegment(this.dimension())]);
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
      ['by-therapy-area', 'by-company', 'by-moa', 'by-roa'].includes(s)
    );

    const posSegment = allSegments.find((s) =>
      (POSITIONING_SEGMENTS as readonly string[]).includes(s)
    );

    if (allSegments.includes('positioning')) {
      this.viewMode.set('positioning');
      this.entityId.set(null);
      if (posSegment) {
        this.state.positioningGrouping.set(segmentToGrouping(posSegment));
      }
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

  private applyQueryParamFilters(): void {
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

  private parseIdList(value: string | null): string[] | null {
    if (!value) return null;
    const ids = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return ids.length > 0 ? ids : null;
  }
}
