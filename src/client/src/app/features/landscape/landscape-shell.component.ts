import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  resource,
  signal,
} from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { routeFadeAnimation } from '../../shared/animations/route-fade.animation';
import { filter } from 'rxjs';
import {
  BullseyeDimension,
  LandscapeIndexEntry,
  SpokeGrouping,
  segmentToGrouping,
  HEATMAP_SEGMENTS,
  ViewMode,
} from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { LandscapeStateService } from './landscape-state.service';
import { LandscapeFilterBarComponent } from './landscape-filter-bar.component';
import { MarkerDetailPanelComponent } from '../../shared/components/marker-detail-panel.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { LoaderComponent } from '../../shared/components/loader/loader.component';

@Component({
  selector: 'app-landscape-shell',
  standalone: true,
  imports: [RouterOutlet, LandscapeFilterBarComponent, MarkerDetailPanelComponent, LoaderComponent],
  animations: [routeFadeAnimation],
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

      <div class="relative flex-1 overflow-hidden" [@routeFade]="viewMode() + '-' + dimension()">
        <router-outlet />

        @if (state.selectedMarkerId()) {
          @if (state.detailLoading() && !state.selectedDetail()) {
            <div
              class="absolute top-0 right-0 bottom-0 z-10 flex w-[340px] items-center justify-center border-l border-slate-200 bg-white"
            >
              <app-loader [size]="36" />
            </div>
          } @else {
            <app-marker-detail-panel
              mode="drawer"
              [detail]="state.selectedDetail()"
              [spaceId]="state.spaceIdSig()"
              [surfaceKey]="viewMode() === 'catalysts' ? 'key_catalysts_panel' : 'timeline_detail'"
              [open]="!!state.selectedMarkerId()"
              (panelClose)="state.clearSelection()"
              (markerClick)="state.selectMarker($event)"
              (eventClick)="onEventClick($event)"
              (trialClick)="onTrialClick($event)"
            />
          }
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandscapeShellComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly landscapeService = inject(LandscapeService);
  readonly state = inject(LandscapeStateService);
  private readonly topbarState = inject(TopbarStateService);

  readonly viewMode = signal<ViewMode>('timeline');
  readonly dimension = signal<BullseyeDimension>('indication');
  readonly entityId = signal<string | null>(null);
  readonly tenantId = signal('');
  readonly spaceId = signal('');

  /** Load entity index for the entity dropdown. */
  readonly entityIndex = resource({
    params: () => ({
      spaceId: this.spaceId(),
      dimension: this.dimension(),
      active: this.viewMode() === 'bullseye',
    }),
    loader: async ({ params }) => {
      if (!params.spaceId || !params.active) return [];
      return this.landscapeService.getLandscapeIndex(params.spaceId, params.dimension);
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

    // Restore persisted landscape state before reading the URL. restorePersistedState()
    // writes heatmapGrouping, so syncStateFromUrl() must run after it to ensure
    // the URL wins -- otherwise a fresh load of /heatmap/by-X shows whichever
    // grouping was in sessionStorage as active, and clicking the URL's tab no-ops.
    this.state.init(this.spaceId());
    this.syncStateFromUrl();

    // Deep-link query params override restored session state
    // (e.g. bullseye "Open in Timeline" links).
    this.applyQueryParamFilters();

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.extractRouteParams();
      this.syncStateFromUrl();
      this.applyQueryParamFilters();
      // Marker selection only makes sense in marker-bearing views
      // (timeline, catalysts). Clear it when entering bullseye /
      // heatmap so a previously-opened drawer doesn't trail along
      // into a view where it has no referent. Selection is preserved
      // between timeline <-> catalysts (same markers, different
      // layout) and across same-mode dimension switches.
      const mode = this.viewMode();
      if (mode === 'bullseye' || mode === 'heatmap') {
        this.state.clearSelection();
      }
    });
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  onEntityChange(entityId: string | null): void {
    // In the new query-param model, entity selection sets a scope filter
    // on the current dimension and navigates to /bullseye with query params.
    const dim = this.dimension();
    const paramKey =
      dim === 'indication'
        ? 'indications'
        : dim === 'company'
          ? 'companies'
          : dim === 'moa'
            ? 'moas'
            : 'roas';
    const queryParams: Record<string, string | null> = { [paramKey]: entityId };
    this.router.navigate([...this.spaceBase(), 'bullseye'], {
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private spaceBase(): string[] {
    return ['/t', this.tenantId(), 's', this.spaceId()];
  }

  onEventClick(eventId: string): void {
    this.router.navigate([...this.spaceBase(), 'events'], { queryParams: { eventId } });
  }

  onTrialClick(trialId: string): void {
    this.router.navigate([...this.spaceBase(), 'manage', 'trials', trialId]);
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

    const heatmapSegment = allSegments.find((s) =>
      (HEATMAP_SEGMENTS as readonly string[]).includes(s)
    );

    if (allSegments.includes('heatmap')) {
      this.viewMode.set('heatmap');
      this.entityId.set(null);
      if (heatmapSegment) {
        this.state.heatmapGrouping.set(segmentToGrouping(heatmapSegment));
      }
    } else if (allSegments.includes('bullseye')) {
      this.viewMode.set('bullseye');
      this.entityId.set(null);
      // Sync spokeGrouping from the ?group= query param if present
      const groupParam = this.route.snapshot.queryParamMap.get('group');
      if (groupParam && ['company', 'indication', 'moa', 'roa', 'asset'].includes(groupParam)) {
        this.state.spokeGrouping.set(groupParam as SpokeGrouping);
      }
    } else if (allSegments.includes('catalysts')) {
      this.viewMode.set('catalysts');
      this.entityId.set(null);
    } else if (allSegments.includes('timeline')) {
      this.viewMode.set('timeline');
      this.entityId.set(null);
    } else {
      // Shouldn't happen now that timeline has its own segment, but leave
      // a sensible default in case the shell mounts without a child.
      this.viewMode.set('timeline');
      this.entityId.set(null);
    }
  }

  private applyQueryParamFilters(): void {
    const qp = this.route.snapshot.queryParamMap;
    // Legacy deep-link params (camelCase)
    const assetIds = this.parseIdList(qp.get('assetIds'));
    const indicationIds = this.parseIdList(qp.get('indicationIds'));
    // Bullseye scope params (short names per spec)
    const indications = this.parseIdList(qp.get('indications'));
    const companies = this.parseIdList(qp.get('companies'));
    const moas = this.parseIdList(qp.get('moas'));
    const roas = this.parseIdList(qp.get('roas'));
    // motion-strip deep-link: phase=P3 (or any RingPhase) scopes the
    // catalysts view to trials in that phase. Parsed from comma-separated
    // values so a single param suffices for the common single-phase case.
    const phases = this.parseIdList(qp.get('phase')) as
      | import('../../core/models/landscape.model').RingPhase[]
      | null;
    if (assetIds || indicationIds || indications || companies || moas || roas || phases) {
      this.state.filters.update((f) => ({
        ...f,
        assetIds: assetIds ?? f.assetIds,
        indicationIds: indications ?? indicationIds ?? f.indicationIds,
        companyIds: companies ?? f.companyIds,
        mechanismOfActionIds: moas ?? f.mechanismOfActionIds,
        routeOfAdministrationIds: roas ?? f.routeOfAdministrationIds,
        phases: phases ?? f.phases,
      }));
    }
    const markerId = qp.get('markerId');
    if (markerId) {
      void this.state.selectMarker(markerId);
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
