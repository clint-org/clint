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
import { ActivatedRoute, Router } from '@angular/router';

import {
  BullseyeData,
  BullseyeDimension,
  BullseyeAsset,
  PHASE_COLOR,
  RingPhase,
  visibleRingOrder,
} from '../../core/models/landscape.model';
import { CTGOV_BULLSEYE_DEFAULT_PATHS } from '../../core/models/ctgov-field.model';
import { LandscapeStateService } from './landscape-state.service';
import {
  AssetIntelligenceNote,
  ENTITY_TYPE_LABEL,
  IntelligenceEntityType,
} from '../../core/models/primary-intelligence.model';
import { DEVELOPMENT_STATUS_LABELS, phaseShortLabel } from '../../core/models/phase-colors';
import { resolveScopeFromRoute } from '../../core/utils/route-scope';
import { recentChangeLabel } from '../../shared/components/change-badge/change-badge.logic';
import { PrimaryIntelligenceService } from '../../core/services/primary-intelligence.service';
import { SpaceFieldVisibilityService } from '../../core/services/space-field-visibility.service';
import { TrialService } from '../../core/services/trial.service';
import { ChangeBadgeComponent } from '../../shared/components/change-badge/change-badge.component';
import { CompanyTileComponent } from '../../shared/components/company-tile.component';
import { CtgovFieldRendererComponent } from '../../shared/components/ctgov-field-renderer/ctgov-field-renderer.component';
import { DetailPanelEmptyStateComponent } from '../../shared/components/detail-panel-empty-state.component';
import { DetailPanelEntityListComponent } from '../../shared/components/detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from '../../shared/components/detail-panel-entity-row.component';
import { DetailPanelPhaseLadderComponent } from '../../shared/components/detail-panel-phase-ladder.component';
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
    CompanyTileComponent,
    CtgovFieldRendererComponent,
    DatePipe,
    DetailPanelEmptyStateComponent,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelPhaseLadderComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    MarkerIconComponent,
  ],
  templateUrl: './bullseye-detail-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BullseyeDetailPanelComponent {
  readonly data = input.required<BullseyeData | null>();
  readonly selectedAsset = input<BullseyeAsset | null>(null);
  readonly loading = input<boolean>(false);
  readonly trialListCap = input<number>(8);
  readonly dimension = input<BullseyeDimension>('indication');

  readonly openTrial = output<string>();
  readonly openCompany = output<string>();
  readonly openInTimeline = output<{ assetId: string; therapeuticAreaId: string }>();
  readonly openMarker = output<string>();
  readonly openIntelligence = output<{ entityType: IntelligenceEntityType; entityId: string }>();
  readonly ringHighlightToggle = output<RingPhase | null>();
  readonly clearSelection = output<void>();

  protected phaseLabel(p: string | null | undefined): string {
    return p ? phaseShortLabel(p) : '';
  }

  protected phaseLongLabel(p: RingPhase): string {
    return DEVELOPMENT_STATUS_LABELS[p] ?? phaseShortLabel(p);
  }

  /** Forwarded to the phase ladder so its scale matches the chart. */
  protected readonly showPreclinical = computed(() => this.state.showPreclinical());

  /**
   * Trials section label. When every tracked trial shares one phase, appends
   * an "ALL PH N" hint so the analyst reads the common phase without scanning
   * each row (matches the mockup's trailing header hint).
   */
  protected readonly trialsSectionLabel = computed<string>(() => {
    const trials = this.selectedAsset()?.trials ?? [];
    const base = `Trials (${trials.length})`;
    if (trials.length < 2) return base;
    const first = trials[0].phase;
    if (!first || first === 'OBS') return base;
    return trials.every((t) => t.phase === first)
      ? `${base} · ALL ${phaseShortLabel(first)}`
      : base;
  });

  protected readonly recentChangeLabel = recentChangeLabel;

  private readonly router = inject(Router);

  protected openChangeEvent(changeEventId: string): void {
    const { tenantId, spaceId } = resolveScopeFromRoute(this.route);
    if (!tenantId || !spaceId) return;
    // Scope the events feed to this asset and filter to detected changes, so
    // the list is the asset's recent changes (its trials roll up) rather than
    // the global feed -- while still opening the most-recent one in the panel.
    const assetId = this.selectedAsset()?.id ?? null;
    void this.router.navigate(['/t', tenantId, 's', spaceId, 'events'], {
      queryParams: {
        detectedId: changeEventId,
        ...(assetId ? { entityLevel: 'product', entityId: assetId, source: 'detected' } : {}),
      },
    });
  }

  private readonly showAllTrials = signal(false);

  // Per-space CT.gov field overlay (bullseye_detail_panel surface). Loaded
  // once when the panel sees a spaceId on its containing route; lazy-loads
  // snapshots only for the trials currently visible in the selected
  // asset trial list.
  private readonly route = inject(ActivatedRoute);
  private readonly state = inject(LandscapeStateService);
  private readonly fieldVisibility = inject(SpaceFieldVisibilityService);
  private readonly trialService = inject(TrialService);
  private readonly intelligenceService = inject(PrimaryIntelligenceService);
  private readonly perSpacePaths = signal<string[] | null>(null);
  private readonly snapshotByTrial = signal<Map<string, unknown>>(new Map());
  readonly intelligenceNotes = signal<AssetIntelligenceNote[]>([]);
  private lastVisibilitySpaceId: string | null = null;
  private resolvedSpaceId: string | null = null;

  readonly bullseyePaths = computed(() => this.perSpacePaths() ?? CTGOV_BULLSEYE_DEFAULT_PATHS);

  constructor() {
    // Reset the "show all" toggle whenever the user selects a different asset
    effect(() => {
      this.selectedAsset();
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
      if (!spaceId) return;
      this.resolvedSpaceId = spaceId;
      if (spaceId === this.lastVisibilitySpaceId) return;
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

    effect(() => {
      const asset = this.selectedAsset();
      this.intelligenceNotes.set([]);
      if (!asset || asset.intelligence_count === 0) return;
      const spaceId = this.resolvedSpaceId;
      if (!spaceId) return;
      void (async () => {
        try {
          const notes = await this.intelligenceService.getIntelligenceNotesForAsset(
            spaceId,
            asset.id
          );
          this.intelligenceNotes.set(notes);
        } catch {
          this.intelligenceNotes.set([]);
        }
      })();
    });
  }

  snapshotFor(trialId: string): unknown | null {
    return this.snapshotByTrial().get(trialId) ?? null;
  }

  protected readonly visibleTrials = computed(() => {
    const asset = this.selectedAsset();
    if (!asset) return [];
    if (this.showAllTrials() || asset.trials.length <= this.trialListCap()) {
      return asset.trials;
    }
    return asset.trials.slice(0, this.trialListCap());
  });

  protected readonly hasMoreTrials = computed(() => {
    const asset = this.selectedAsset();
    if (!asset) return false;
    return asset.trials.length > this.trialListCap() && !this.showAllTrials();
  });

  protected readonly hiddenTrialCount = computed(() => {
    const asset = this.selectedAsset();
    if (!asset) return 0;
    return Math.max(0, asset.trials.length - this.trialListCap());
  });

  protected readonly allAssets = computed(() => {
    return this.data()?.spokes.flatMap((s) => s.products) ?? [];
  });

  protected readonly ringHistogram = computed<RingHistogramEntry[]>(() => {
    const assets = this.allAssets();
    const visible = visibleRingOrder(this.state.showPreclinical());
    const counts = new Map<RingPhase, number>();
    for (const phase of visible) counts.set(phase, 0);
    for (const asset of assets) {
      counts.set(asset.highest_phase, (counts.get(asset.highest_phase) ?? 0) + 1);
    }
    // Present in descending development order (launched at the top)
    return [...visible].reverse().map((phase) => ({ phase, count: counts.get(phase) ?? 0 }));
  });

  protected readonly totalAssets = computed(() => this.allAssets().length);
  protected readonly totalSpokes = computed(() => this.data()?.spokes.length ?? 0);
  protected readonly spokeLabel = computed(() => this.data()?.spoke_label ?? 'Companies');

  protected readonly headerLabel = computed(() =>
    this.selectedAsset() ? 'Asset' : 'Bullseye · overview'
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

  protected onIntelligenceClick(note: AssetIntelligenceNote): void {
    this.openIntelligence.emit({ entityType: note.entity_type, entityId: note.entity_id });
  }

  protected entityTypeLabel(entityType: IntelligenceEntityType): string {
    return ENTITY_TYPE_LABEL[entityType];
  }

  protected onCompanyClick(): void {
    const p = this.selectedAsset();
    if (p) this.openCompany.emit(p.company_id);
  }

  protected onOpenTimeline(): void {
    const p = this.selectedAsset();
    const d = this.data();
    if (p && d?.scope) {
      this.openInTimeline.emit({ assetId: p.id, therapeuticAreaId: d.scope.id });
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
