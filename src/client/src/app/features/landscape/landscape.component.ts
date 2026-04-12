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

@Component({
  selector: 'app-landscape',
  standalone: true,
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
  templateUrl: './landscape.component.html',
})
export class LandscapeComponent implements OnInit {
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

  private static parseDimension(segment: string): BullseyeDimension {
    const map: Record<string, BullseyeDimension> = {
      'by-therapy-area': 'therapeutic-area',
      'by-company': 'company',
      'by-moa': 'moa',
      'by-roa': 'roa',
    };
    return map[segment] ?? 'therapeutic-area';
  }

  readonly spokeModeOptions = computed(() => {
    const label = this.bullseyeData.value()?.spoke_label ?? 'Groups';
    return [
      { label, value: 'grouped' as SpokeMode },
      { label: 'Products', value: 'products' as SpokeMode },
    ];
  });

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

  readonly allProducts = computed<BullseyeProduct[]>(() => {
    return this.bullseyeData.value()?.spokes.flatMap((s) => s.products) ?? [];
  });

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

  readonly selectedProduct = computed<BullseyeProduct | null>(() => {
    const id = this.selectedProductId();
    if (!id) return null;
    return this.allProducts().find((p) => p.id === id) ?? null;
  });

  readonly matchedProductIds = computed<Set<string> | null>(() => {
    const f = this.landscapeFilters();
    const noneActive =
      f.mechanismOfActionIds.length === 0 &&
      f.routeOfAdministrationIds.length === 0 &&
      f.companyIds.length === 0 &&
      f.productIds.length === 0 &&
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
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'manage',
      'trials',
      trialId,
    ]);
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

  onLandscapeFiltersChange(filters: LandscapeFilters): void {
    this.landscapeFilters.set(filters);
  }

  retry(): void {
    this.bullseyeData.reload();
  }

  private productMatches(product: BullseyeProduct, f: LandscapeFilters): boolean {
    if (f.mechanismOfActionIds.length > 0) {
      const ok = (product.moas ?? []).some((m) => f.mechanismOfActionIds.includes(m.id));
      if (!ok) return false;
    }
    if (f.routeOfAdministrationIds.length > 0) {
      const ok = (product.roas ?? []).some((r) => f.routeOfAdministrationIds.includes(r.id));
      if (!ok) return false;
    }
    if (f.companyIds.length > 0 && !f.companyIds.includes(product.company_id)) return false;
    if (f.productIds.length > 0 && !f.productIds.includes(product.id)) return false;
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
