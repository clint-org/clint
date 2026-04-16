import { Component, computed, effect, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';

import {
  BullseyeData,
  BullseyeDimension,
  BullseyeProduct,
  PHASE_COLOR,
  RING_ORDER,
  RingPhase,
} from '../../core/models/landscape.model';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';

interface RingHistogramEntry {
  phase: RingPhase;
  count: number;
}

@Component({
  selector: 'app-bullseye-detail-panel',
  standalone: true,
  imports: [ButtonModule, DatePipe, DetailPanelShellComponent],
  templateUrl: './bullseye-detail-panel.component.html',
})
export class BullseyeDetailPanelComponent {
  readonly data = input.required<BullseyeData | null>();
  readonly selectedProduct = input<BullseyeProduct | null>(null);
  readonly loading = input<boolean>(false);
  readonly trialListCap = input<number>(8);
  readonly dimension = input<BullseyeDimension>('therapeutic-area');

  readonly openTrial = output<string>();
  readonly openCompany = output<string>();
  readonly openInTimeline = output<{ productId: string; therapeuticAreaId: string }>();
  readonly ringHighlightToggle = output<RingPhase | null>();
  readonly clearSelection = output<void>();

  private readonly showAllTrials = signal(false);

  constructor() {
    // Reset the "show all" toggle whenever the user selects a different product
    effect(() => {
      this.selectedProduct();
      this.showAllTrials.set(false);
    });
  }

  protected readonly visibleTrials = computed(() => {
    const product = this.selectedProduct();
    if (!product) return [];
    if (this.showAllTrials() || product.trials.length <= this.trialListCap()) {
      return product.trials;
    }
    return product.trials.slice(0, this.trialListCap());
  });

  protected readonly hasMoreTrials = computed(() => {
    const product = this.selectedProduct();
    if (!product) return false;
    return product.trials.length > this.trialListCap() && !this.showAllTrials();
  });

  protected readonly hiddenTrialCount = computed(() => {
    const product = this.selectedProduct();
    if (!product) return 0;
    return Math.max(0, product.trials.length - this.trialListCap());
  });

  protected readonly allProducts = computed(() => {
    return this.data()?.spokes.flatMap((s) => s.products) ?? [];
  });

  protected readonly ringHistogram = computed<RingHistogramEntry[]>(() => {
    const products = this.allProducts();
    const counts = new Map<RingPhase, number>();
    for (const phase of RING_ORDER) counts.set(phase, 0);
    for (const product of products) {
      counts.set(product.highest_phase, (counts.get(product.highest_phase) ?? 0) + 1);
    }
    // Present in descending development order (launched at the top)
    return [...RING_ORDER].reverse().map((phase) => ({ phase, count: counts.get(phase) ?? 0 }));
  });

  protected readonly totalProducts = computed(() => this.allProducts().length);
  protected readonly totalSpokes = computed(() => this.data()?.spokes.length ?? 0);
  protected readonly spokeLabel = computed(() => this.data()?.spoke_label ?? 'Companies');

  protected isScopedMoa(moaId: string): boolean {
    const d = this.data();
    return d?.dimension === 'moa' && d.scope.id === moaId;
  }

  protected isScopedRoa(roaId: string): boolean {
    const d = this.data();
    return d?.dimension === 'roa' && d.scope.id === roaId;
  }

  protected onTrialClick(trialId: string): void {
    this.openTrial.emit(trialId);
  }

  protected onCompanyClick(): void {
    const p = this.selectedProduct();
    if (p) this.openCompany.emit(p.company_id);
  }

  protected onOpenTimeline(): void {
    const p = this.selectedProduct();
    const d = this.data();
    if (p && d?.scope) {
      this.openInTimeline.emit({ productId: p.id, therapeuticAreaId: d.scope.id });
    }
  }

  protected onRingRowClick(phase: RingPhase): void {
    this.ringHighlightToggle.emit(phase);
  }

  protected onShowAllTrials(): void {
    this.showAllTrials.set(true);
  }

  protected onClearSelection(): void {
    this.clearSelection.emit();
  }

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }
}
