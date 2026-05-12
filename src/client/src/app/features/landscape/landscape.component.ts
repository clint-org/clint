import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  OnInit,
  resource,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { Tooltip } from 'primeng/tooltip';

import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import {
  BullseyeDimension,
  BullseyeAsset,
  BullseyeSpoke,
  LandscapeFilters,
  RingPhase,
  segmentToDimension,
} from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { BullseyeChartComponent } from './bullseye-chart.component';
import { BullseyeDetailPanelComponent } from './bullseye-detail-panel.component';
import { BullseyeTooltipComponent } from './bullseye-tooltip.component';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-landscape',
  standalone: true,
  imports: [
    BullseyeChartComponent,
    BullseyeDetailPanelComponent,
    BullseyeTooltipComponent,
    RouterLink,
    ButtonModule,
    MessageModule,
    SkeletonComponent,
    Tooltip,
  ],
  templateUrl: './landscape.component.html',
  animations: [slidePanelAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  readonly selectedAssetId = signal<string | null>(null);
  readonly hoveredAssetId = signal<string | null>(null);
  readonly highlightedRing = signal<RingPhase | null>(null);
  readonly tooltipX = signal(0);
  readonly tooltipY = signal(0);

  readonly bullseyeData = resource({
    params: () => ({
      spaceId: this.spaceId(),
      dimension: this.dimension(),
      entityId: this.entityId(),
    }),
    loader: async ({ params }) => {
      if (!params.spaceId || !params.entityId) return null;
      return this.landscapeService.getBullseyeData(
        params.spaceId,
        params.dimension,
        params.entityId
      );
    },
  });

  readonly allAssets = computed<BullseyeAsset[]>(
    () => this.bullseyeData.value()?.spokes.flatMap((s) => s.products) ?? []
  );

  readonly chartData = computed(() => {
    const data = this.bullseyeData.value();
    if (!data) return null;
    if (this.state.spokeMode() === 'grouped') return data;

    const allAssets = data.spokes.flatMap((s) => s.products);
    const productSpokes: BullseyeSpoke[] = allAssets.map((p) => ({
      id: p.id,
      name: p.name,
      display_order: 0,
      highest_phase_rank: p.highest_phase_rank,
      products: [p],
    }));
    return { ...data, spokes: productSpokes, spoke_label: 'Assets' };
  });

  readonly selectedAsset = computed<BullseyeAsset | null>(() => {
    const id = this.selectedAssetId();
    if (!id) return null;
    return this.allAssets().find((p) => p.id === id) ?? null;
  });

  readonly matchedAssetIds = computed<Set<string> | null>(() => {
    const f = this.state.filters();
    const noneActive =
      f.companyIds.length === 0 &&
      f.assetIds.length === 0 &&
      f.therapeuticAreaIds.length === 0 &&
      f.mechanismOfActionIds.length === 0 &&
      f.routeOfAdministrationIds.length === 0 &&
      f.phases.length === 0 &&
      f.recruitmentStatuses.length === 0 &&
      f.studyTypes.length === 0;
    if (noneActive) return null;

    const matched = new Set<string>();
    for (const product of this.allAssets()) {
      if (this.productMatches(product, f)) matched.add(product.id);
    }
    return matched;
  });

  readonly hoveredAsset = computed<BullseyeAsset | null>(() => {
    const id = this.hoveredAssetId();
    if (!id) return null;
    return this.allAssets().find((p) => p.id === id) ?? null;
  });

  constructor() {
    effect(() => {
      const data = this.bullseyeData.value();
      const currentSelected = this.selectedAssetId();
      if (!data || !currentSelected) return;
      const exists = data.spokes.some((s) => s.products.some((p) => p.id === currentSelected));
      if (!exists) {
        this.selectedAssetId.set(null);
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
    this.selectedAssetId.set(this.route.snapshot.queryParamMap.get('product'));

    const urlSegments = this.route.snapshot.url;
    const dimensionSegment = urlSegments.find((s) =>
      ['by-therapy-area', 'by-company', 'by-moa', 'by-roa'].includes(s.path)
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
      this.selectedAssetId.set(qp.get('product'));
    });
  }

  onAssetHover(assetId: string | null): void {
    this.hoveredAssetId.set(assetId);
    if (assetId) {
      const handler = (e: MouseEvent) => {
        this.tooltipX.set(e.clientX);
        this.tooltipY.set(e.clientY);
        document.removeEventListener('mousemove', handler);
      };
      document.addEventListener('mousemove', handler);
    }
  }

  onAssetClick(assetId: string): void {
    this.selectedAssetId.set(assetId);
    this.highlightedRing.set(null);
    this.updateQueryParam(assetId);
  }

  onBackgroundClick(): void {
    if (this.selectedAssetId() !== null) {
      this.selectedAssetId.set(null);
      this.updateQueryParam(null);
    }
  }

  onClearSelection(): void {
    this.selectedAssetId.set(null);
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

  onOpenCompany(companyId: string): void {
    if (!companyId) return;
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'manage',
      'companies',
      companyId,
    ]);
  }

  onOpenInTimeline(payload: { assetId: string; therapeuticAreaId: string }): void {
    // Land on the actual timeline view, not the space root (which renders
    // the landscape index). Filters thread through as query params and are
    // applied in landscape-shell's applyQueryParamFilters().
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'timeline'], {
      queryParams: {
        assetIds: payload.assetId,
        therapeuticAreaIds: payload.therapeuticAreaId,
      },
    });
  }

  onOpenMarker(markerId: string): void {
    const product = this.selectedAsset();
    const taId = this.entityId();
    const queryParams: Record<string, string> = { markerId };
    if (product) queryParams['assetIds'] = product.id;
    if (taId) queryParams['therapeuticAreaIds'] = taId;
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'timeline'], {
      queryParams,
    });
  }

  retry(): void {
    this.bullseyeData.reload();
  }

  private productMatches(product: BullseyeAsset, f: LandscapeFilters): boolean {
    if (f.companyIds.length > 0 && !f.companyIds.includes(product.company_id)) return false;
    if (f.assetIds.length > 0 && !f.assetIds.includes(product.id)) return false;
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
        (t) => t.recruitment_status != null && f.recruitmentStatuses.includes(t.recruitment_status)
      );
      if (!ok) return false;
    }
    if (f.studyTypes.length > 0) {
      const ok = (product.trials ?? []).some(
        (t) => t.study_type != null && f.studyTypes.includes(t.study_type)
      );
      if (!ok) return false;
    }
    return true;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectedAssetId() !== null) {
      this.onClearSelection();
    }
  }

  private updateQueryParam(assetId: string | null): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { product: assetId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
