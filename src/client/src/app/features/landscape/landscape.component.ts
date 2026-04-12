import { Component, computed, effect, HostListener, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import {
  BullseyeProduct,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  RingPhase,
} from '../../core/models/landscape.model';
import { TherapeuticArea } from '../../core/models/trial.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { TherapeuticAreaService } from '../../core/services/therapeutic-area.service';
import { BullseyeChartComponent } from './bullseye-chart.component';
import { BullseyeDetailPanelComponent } from './bullseye-detail-panel.component';
import { LandscapeFilterBarComponent } from './landscape-filter-bar.component';
import { TaSelectorComponent } from './ta-selector.component';

@Component({
  selector: 'app-landscape',
  standalone: true,
  imports: [
    BullseyeChartComponent,
    BullseyeDetailPanelComponent,
    LandscapeFilterBarComponent,
    TaSelectorComponent,
    RouterLink,
    ButtonModule,
    MessageModule,
    ProgressSpinner,
  ],
  templateUrl: './landscape.component.html',
})
export class LandscapeComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly therapeuticAreaService = inject(TherapeuticAreaService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly taId = signal('');

  readonly selectedProductId = signal<string | null>(null);
  readonly hoveredProductId = signal<string | null>(null);
  readonly highlightedRing = signal<RingPhase | null>(null);

  readonly therapeuticAreas = signal<TherapeuticArea[]>([]);
  readonly landscapeFilters = signal<LandscapeFilters>({ ...EMPTY_LANDSCAPE_FILTERS });

  readonly bullseyeData = resource({
    request: () => ({ spaceId: this.spaceId(), taId: this.taId() }),
    loader: async ({ request }) => {
      if (!request.spaceId || !request.taId) return null;
      return this.landscapeService.getBullseyeData(request.spaceId, request.taId);
    },
  });

  readonly allProducts = computed<BullseyeProduct[]>(() => {
    return this.bullseyeData.value()?.companies.flatMap((c) => c.products) ?? [];
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
    // Sync route params (path + query) into local signals so the resource
    // refetches automatically when the TA changes and the selection
    // survives deep links.
    effect(() => {
      const params = this.route.snapshot.paramMap;
      this.tenantId.set(params.get('tenantId') ?? '');
      this.spaceId.set(params.get('spaceId') ?? '');
      this.taId.set(params.get('therapeuticAreaId') ?? '');
      const queryProduct = this.route.snapshot.queryParamMap.get('product');
      this.selectedProductId.set(queryProduct);
    });

    // When the loaded data changes, drop the selection if the product is no
    // longer present (e.g. after a TA switch); otherwise keep it.
    effect(() => {
      const data = this.bullseyeData.value();
      const currentSelected = this.selectedProductId();
      if (!data || !currentSelected) return;
      const exists = data.companies.some((c) => c.products.some((p) => p.id === currentSelected));
      if (!exists) {
        this.selectedProductId.set(null);
        this.updateQueryParam(null);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Load the TA list for the selector dropdown
    const tenantId = this.route.snapshot.paramMap.get('tenantId') ?? '';
    const spaceId = this.route.snapshot.paramMap.get('spaceId') ?? '';
    this.tenantId.set(tenantId);
    this.spaceId.set(spaceId);
    try {
      const tas = await this.therapeuticAreaService.list(spaceId);
      this.therapeuticAreas.set(tas);
    } catch {
      this.therapeuticAreas.set([]);
    }
    // Seed the current route param into the signal on first load
    this.taId.set(this.route.snapshot.paramMap.get('therapeuticAreaId') ?? '');
    this.selectedProductId.set(this.route.snapshot.queryParamMap.get('product'));

    // Subscribe to param + query param changes so the effects above re-fire
    this.route.paramMap.subscribe((params) => {
      this.tenantId.set(params.get('tenantId') ?? '');
      this.spaceId.set(params.get('spaceId') ?? '');
      this.taId.set(params.get('therapeuticAreaId') ?? '');
    });
    this.route.queryParamMap.subscribe((qp) => {
      this.selectedProductId.set(qp.get('product'));
    });
  }

  onTaSelect(newTaId: string): void {
    if (newTaId === this.taId()) return;
    this.router.navigate(
      ['/t', this.tenantId(), 's', this.spaceId(), 'landscape', newTaId],
      { queryParamsHandling: '' }
    );
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
