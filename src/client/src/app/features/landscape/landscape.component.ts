import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
  BullseyeAsset,
  BullseyeData,
  LandscapeFilters,
  RING_ORDER,
  RingPhase,
  SPOKE_GROUPING_OPTIONS,
  groupAssetsIntoSpokes,
} from '../../core/models/landscape.model';
import { IntelligenceEntityType } from '../../core/models/primary-intelligence.model';
import { buildEntityRouterLink } from '../../shared/utils/intelligence-router-link';
import { LandscapeService } from '../../core/services/landscape.service';
import { BullseyeChartComponent } from './bullseye-chart.component';
import { BullseyeControlsPanelComponent } from './bullseye-controls-panel.component';
import { BullseyeDetailPanelComponent } from './bullseye-detail-panel.component';
import { BullseyeTooltipComponent } from './bullseye-tooltip.component';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-landscape',
  imports: [
    BullseyeChartComponent,
    BullseyeControlsPanelComponent,
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
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class LandscapeComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly state = inject(LandscapeStateService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');

  readonly selectedAssetId = signal<string | null>(null);
  readonly hoveredAssetId = signal<string | null>(null);
  readonly highlightedRing = signal<RingPhase | null>(null);
  readonly tooltipX = signal(0);
  readonly tooltipY = signal(0);

  readonly bullseyeAssets = resource({
    params: () => ({
      spaceId: this.spaceId(),
      filters: this.state.filters(),
    }),
    loader: async ({ params }) => {
      if (!params.spaceId) return null;
      return this.landscapeService.getBullseyeAssets(params.spaceId, params.filters);
    },
  });

  readonly allAssets = computed<BullseyeAsset[]>(() => this.bullseyeAssets.value() ?? []);

  /** Intermediate computed that holds the raw grouping result. */
  private readonly groupedResult = computed(() => {
    const assets = this.bullseyeAssets.value();
    if (!assets?.length) return null;
    return groupAssetsIntoSpokes(assets, this.state.spokeGrouping());
  });

  readonly chartData = computed<BullseyeData | null>(() => {
    const result = this.groupedResult();
    if (!result) return null;
    return {
      dimension: this.state.spokeGrouping() as BullseyeData['dimension'],
      scope: { id: 'scope', name: 'Filtered' },
      ring_order: RING_ORDER as unknown as RingPhase[],
      spokes: result.spokes,
      spoke_label:
        SPOKE_GROUPING_OPTIONS.find((o) => o.value === this.state.spokeGrouping())?.label ??
        'Company',
    } satisfies BullseyeData;
  });

  /** Tracks asset IDs that appear on multiple spokes (dashed outline). */
  readonly duplicatedAssetIds = computed<Set<string>>(
    () => this.groupedResult()?.duplicatedAssetIds ?? new Set()
  );

  readonly selectedAsset = computed<BullseyeAsset | null>(() => {
    const id = this.selectedAssetId();
    if (!id) return null;
    return this.allAssets().find((p) => p.id === id) ?? null;
  });

  /**
   * Dims assets that don't match recruitment status or study type filters.
   * Scope-level filters (companies, indications, moas, roas, phases, assets)
   * are handled at the fetch level and no longer need client-side matching.
   */
  readonly matchedAssetIds = computed<Set<string> | null>(() => {
    const f = this.state.filters();
    const hasDimFilters = f.recruitmentStatuses.length > 0 || f.studyTypes.length > 0;
    if (!hasDimFilters) return null;

    const matched = new Set<string>();
    for (const product of this.allAssets()) {
      if (this.productMatchesDimFilters(product, f)) matched.add(product.id);
    }
    return matched;
  });

  readonly hoveredAsset = computed<BullseyeAsset | null>(() => {
    const id = this.hoveredAssetId();
    if (!id) return null;
    return this.allAssets().find((p) => p.id === id) ?? null;
  });

  /** Number of spokes the hovered asset appears on (for duplicate indicator). */
  readonly hoveredAssetSpokeCount = computed<number>(() => {
    const id = this.hoveredAssetId();
    const result = this.groupedResult();
    if (!id || !result) return 0;
    return result.spokes.filter((s) => s.products.some((p) => p.id === id)).length;
  });

  constructor() {
    effect(() => {
      const assets = this.bullseyeAssets.value();
      const currentSelected = this.selectedAssetId();
      if (!assets || !currentSelected) return;
      const exists = assets.some((a) => a.id === currentSelected);
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
    this.selectedAssetId.set(this.route.snapshot.queryParamMap.get('product'));

    this.route.paramMap.subscribe(() => {
      this.tenantId.set(this.collectParam('tenantId'));
      this.spaceId.set(this.collectParam('spaceId'));
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
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'timeline'], {
      queryParams: {
        assetIds: payload.assetId,
        indicationIds: payload.therapeuticAreaId,
      },
    });
  }

  onOpenMarker(markerId: string): void {
    const product = this.selectedAsset();
    const queryParams: Record<string, string> = { markerId };
    if (product) queryParams['assetIds'] = product.id;
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'timeline'], {
      queryParams,
    });
  }

  onOpenIntelligence(payload: { entityType: IntelligenceEntityType; entityId: string }): void {
    const link = buildEntityRouterLink(
      this.tenantId(),
      this.spaceId(),
      payload.entityType,
      payload.entityId
    );
    if (link) this.router.navigate(link as string[]);
  }

  retry(): void {
    this.bullseyeAssets.reload();
  }

  protected onEscape(): void {
    if (this.selectedAssetId() !== null) {
      this.onClearSelection();
    }
  }

  /**
   * Matches assets against dim-level filters that should dim (not exclude).
   * Recruitment statuses and study types are not part of the RPC scope filters,
   * so they are applied client-side as visual dimming.
   */
  private productMatchesDimFilters(product: BullseyeAsset, f: LandscapeFilters): boolean {
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

  private updateQueryParam(assetId: string | null): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { product: assetId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
