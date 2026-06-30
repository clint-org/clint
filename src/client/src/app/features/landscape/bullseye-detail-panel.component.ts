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
  BullseyeAsset,
  BullseyeMarker,
  PHASE_COLOR,
  RingPhase,
  visibleRingOrder,
} from '../../core/models/landscape.model';
import {
  ProjectionBadge,
  projectionBadge,
  projectionOutlineDash,
} from '../../core/models/marker-visual';
import { CTGOV_BULLSEYE_DEFAULT_PATHS } from '../../core/models/ctgov-field.model';
import { LandscapeStateService } from './landscape-state.service';
import { deriveBullseyeEventBuckets } from './bullseye-events';
import {
  AssetIntelligenceNote,
  IntelligenceEntityType,
  PiReference,
} from '../../core/models/primary-intelligence.model';
import { DEVELOPMENT_STATUS_LABELS, phaseShortLabel } from '../../core/models/phase-colors';
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
import { BullseyeSignalMarkComponent } from './bullseye-signal-mark.component';
import { PiDetailSectionComponent } from '../../shared/components/pi-detail-section/pi-detail-section.component';

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
    BullseyeSignalMarkComponent,
    PiDetailSectionComponent,
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
  /** Whether the selected asset appears on more than one spoke. Drives the
   *  dashed multi-spoke ring on the identity chart mark. */
  readonly multiSpoke = input<boolean>(false);

  readonly openAsset = output<string>();
  readonly openTrial = output<string>();
  readonly openCompany = output<string>();
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

  /**
   * Split the focused asset's events into Recent (past) and Upcoming (future)
   * buckets so the panel renders two symmetric lists from the single
   * `recent_markers` source the bullseye RPC returns.
   */
  protected readonly eventBuckets = computed(() =>
    deriveBullseyeEventBuckets(this.selectedAsset()?.recent_markers ?? [])
  );
  protected readonly recentEvents = computed(() => this.eventBuckets().recent);
  protected readonly upcomingEvents = computed(() => this.eventBuckets().upcoming);

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
  readonly companyIntelligenceRefs = signal<PiReference[]>([]);

  /**
   * Asset/trial PI notes plus the asset's company-level briefs, mapped to the
   * shared PiDetailSection reference shape. Company briefs carry entity_type
   * 'company' so they render with a "Company" tag in the same list rather than
   * a separate section.
   */
  protected readonly intelligenceReferences = computed<PiReference[]>(() => [
    ...this.intelligenceNotes().map((n) => ({
      id: n.id,
      entity_type: n.entity_type,
      entity_id: n.entity_id,
      entity_name: n.entity_name,
      headline: n.headline,
    })),
    ...this.companyIntelligenceRefs(),
  ]);
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

    // Fetch company-level intelligence for the selected asset's parent company.
    // Shown as a separate "Company intelligence" section below the asset PI block.
    // Runs on every asset selection change; guards against stale responses.
    effect(() => {
      const asset = this.selectedAsset();
      this.companyIntelligenceRefs.set([]);
      if (!asset) return;
      const spaceId = this.resolvedSpaceId;
      if (!spaceId) return;
      const capturedAsset = asset;
      void (async () => {
        try {
          const briefs = await this.intelligenceService.listIntelligenceForEntity(
            spaceId,
            'company',
            asset.company_id
          );
          if (this.selectedAsset() !== capturedAsset) return;
          const refs: PiReference[] = briefs
            .filter((br) => br.published !== null)
            .map((br) => ({
              id: br.published!.record.id,
              entity_type: 'company' as IntelligenceEntityType,
              entity_id: asset.company_id,
              entity_name: asset.company_name,
              headline: br.published!.record.headline,
            }));
          this.companyIntelligenceRefs.set(refs);
        } catch {
          if (this.selectedAsset() === capturedAsset) this.companyIntelligenceRefs.set([]);
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

  /** Projection tier badge + forecast dash, matching the timeline glyph. */
  protected markerBadge(marker: BullseyeMarker): ProjectionBadge {
    return projectionBadge(marker.projection);
  }

  protected markerOutlineDash(marker: BullseyeMarker): boolean {
    return projectionOutlineDash(marker.projection);
  }

  protected onIntelligenceClick(ref: PiReference): void {
    this.openIntelligence.emit({
      entityType: ref.entity_type as IntelligenceEntityType,
      entityId: ref.entity_id,
    });
  }

  protected onAssetClick(): void {
    const p = this.selectedAsset();
    if (p) this.openAsset.emit(p.id);
  }

  protected onCompanyClick(): void {
    const p = this.selectedAsset();
    if (p) this.openCompany.emit(p.company_id);
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
