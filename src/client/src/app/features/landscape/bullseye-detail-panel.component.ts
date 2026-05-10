import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import {
  BullseyeData,
  BullseyeDimension,
  BullseyeProduct,
  PHASE_COLOR,
  RING_ORDER,
  RingPhase,
} from '../../core/models/landscape.model';
import { CTGOV_BULLSEYE_DEFAULT_PATHS } from '../../core/models/ctgov-field.model';
import { SpaceFieldVisibilityService } from '../../core/services/space-field-visibility.service';
import { TrialService } from '../../core/services/trial.service';
import { ChangeBadgeComponent } from '../../shared/components/change-badge/change-badge.component';
import { CtgovFieldRendererComponent } from '../../shared/components/ctgov-field-renderer/ctgov-field-renderer.component';
import { DetailPanelEmptyStateComponent } from '../../shared/components/detail-panel-empty-state.component';
import { DetailPanelEntityListComponent } from '../../shared/components/detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from '../../shared/components/detail-panel-entity-row.component';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';
import { MarkerIconComponent } from '../../shared/components/svg-icons/marker-icon.component';

interface RingHistogramEntry {
  phase: RingPhase;
  count: number;
}

@Component({
  selector: 'app-bullseye-detail-panel',
  standalone: true,
  imports: [
    ChangeBadgeComponent,
    CtgovFieldRendererComponent,
    DatePipe,
    DetailPanelEmptyStateComponent,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    MarkerIconComponent,
  ],
  templateUrl: './bullseye-detail-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  readonly openMarker = output<string>();
  readonly ringHighlightToggle = output<RingPhase | null>();
  readonly clearSelection = output<void>();

  private readonly showAllTrials = signal(false);

  // Per-space CT.gov field overlay (bullseye_detail_panel surface). Loaded
  // once when the panel sees a spaceId on its containing route; lazy-loads
  // snapshots only for the trials currently visible in the selected
  // product's trial list.
  private readonly route = inject(ActivatedRoute);
  private readonly fieldVisibility = inject(SpaceFieldVisibilityService);
  private readonly trialService = inject(TrialService);
  private readonly perSpacePaths = signal<string[] | null>(null);
  private readonly snapshotByTrial = signal<Map<string, unknown>>(new Map());
  private lastVisibilitySpaceId: string | null = null;

  readonly bullseyePaths = computed(() => this.perSpacePaths() ?? CTGOV_BULLSEYE_DEFAULT_PATHS);

  constructor() {
    // Reset the "show all" toggle whenever the user selects a different product
    effect(() => {
      this.selectedProduct();
      this.showAllTrials.set(false);
    });

    // Load the per-space visibility map once when the spaceId is available
    // on the route. Walks up the snapshot chain because this panel mounts as
    // a sibling of the landscape view, not under a spaceId-keyed route of
    // its own.
    effect(() => {
      let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
      let spaceId: string | null = null;
      while (snap) {
        if (snap.paramMap.has('spaceId')) {
          spaceId = snap.paramMap.get('spaceId');
          break;
        }
        snap = snap.parent;
      }
      if (!spaceId || spaceId === this.lastVisibilitySpaceId) return;
      this.lastVisibilitySpaceId = spaceId;
      void (async () => {
        try {
          const map = await this.fieldVisibility.get(spaceId);
          const paths = map['bullseye_detail_panel'];
          this.perSpacePaths.set(paths && paths.length > 0 ? paths : null);
        } catch {
          this.perSpacePaths.set(null);
        }
      })();
    });

    // Lazy-load latest snapshots whenever the visible trial list changes.
    // Short-circuits on cache hit so toggling "Show all" does not refetch
    // already-loaded snapshots.
    effect(() => {
      const trials = this.visibleTrials();
      if (this.bullseyePaths().length === 0) return;
      const have = this.snapshotByTrial();
      const missing = trials.map((t) => t.id).filter((id) => !have.has(id));
      if (missing.length === 0) return;
      void (async () => {
        const results = await Promise.all(
          missing.map(async (id) => {
            try {
              const s = await this.trialService.getLatestSnapshot(id);
              return [id, s?.payload ?? null] as const;
            } catch {
              return [id, null] as const;
            }
          })
        );
        this.snapshotByTrial.update((m) => {
          const next = new Map(m);
          for (const [id, payload] of results) next.set(id, payload);
          return next;
        });
      })();
    });
  }

  snapshotFor(trialId: string): unknown | null {
    return this.snapshotByTrial().get(trialId) ?? null;
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

  protected readonly headerLabel = computed(() =>
    this.selectedProduct() ? 'Drug' : 'Bullseye · overview'
  );

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

  protected onMarkerRowClick(markerId: string): void {
    this.openMarker.emit(markerId);
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

  protected isTerminalStatus(status: string): boolean {
    const terminal = ['completed', 'terminated', 'withdrawn', 'suspended', 'no longer available'];
    return terminal.includes(status.toLowerCase());
  }

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }
}
