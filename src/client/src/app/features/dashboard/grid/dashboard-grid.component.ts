import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { Marker } from '../../../core/models/marker.model';
import { effectiveVisibility } from '../../../core/models/marker-visibility';
import {
  PHASE_COLORS,
  PHASE_FALLBACK_COLOR,
  phaseOrder,
  phaseShortLabel,
} from '../../../core/models/phase-colors';
import { Trial } from '../../../core/models/trial.model';
import { TimelineColumn, TimelineService } from '../../../core/services/timeline.service';
import { deriveTrialPhaseSpan, TrialPhaseSpan } from '../../../core/models/trial-phase-span';
import { DetailLevel, GridDensity, LandscapeStateService } from '../../landscape/landscape-state.service';
import { markerPeriodLabel, markerStartCaption } from '../../../core/models/marker-date-precision';
import { MARKER_ICON_SIZE } from '../../../shared/utils/grid-constants';
import { textColorOnWhite } from '../../../shared/utils/color-contrast';
import { computeInitialScrollLeft } from './initial-scroll';
import {
  CaptionInterval,
  estimateCaptionWidthPx,
  placeOptionalCaptions,
  visibleLabelMarkerIds,
} from './marker-label-layout';
import { TooltipModule } from 'primeng/tooltip';

import { ChangeBadgeComponent } from '../../../shared/components/change-badge/change-badge.component';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { PiMarkComponent } from '../../../shared/components/pi-mark/pi-mark.component';
import { GridHeaderComponent } from './grid-header.component';
import { MarkerComponent } from './marker.component';
import { PhaseBarComponent } from './phase-bar.component';

export interface FlattenedTrial {
  companyName: string;
  companyId: string;
  companyLogoUrl: string | null;
  assetName: string;
  assetId: string;
  assetLogoUrl: string | null;
  assetMoas: { id: string; name: string }[];
  assetRoas: { id: string; name: string; abbreviation: string | null }[];
  trialIndications: { id: string; name: string }[];
  trial: Trial;
  phaseSpan: TrialPhaseSpan;
  isFirstInCompany: boolean;
  isFirstInAsset: boolean;
  isLastInCompany: boolean;
  companyHasIntelligence: boolean;
  companyIntelligenceHeadline: string | null;
  assetHasIntelligence: boolean;
  assetIntelligenceHeadline: string | null;
}

/**
 * The timeline grid renders three row levels (company band, asset lane, trial
 * rows) as one ordered list. Each row carries only the events anchored to its
 * own entity (no roll-up); the per-level visibility toggles add or drop whole
 * levels. `events` on the band/lane rows is pre-filtered to effectively-visible
 * events (pinned, or high significance) -- feed-only events never get a glyph.
 */
export interface CompanyBandRow {
  kind: 'company';
  companyId: string;
  companyName: string;
  companyLogoUrl: string | null;
  companyHasIntelligence: boolean;
  companyIntelligenceHeadline: string | null;
  events: Marker[];
  isFirstInCompany: boolean;
  isLastInCompany: boolean;
}

export interface AssetLaneRow {
  kind: 'asset';
  companyId: string;
  companyName: string;
  companyLogoUrl: string | null;
  assetId: string;
  assetName: string;
  assetLogoUrl: string | null;
  assetHasIntelligence: boolean;
  assetIntelligenceHeadline: string | null;
  assetMoas: { id: string; name: string }[];
  assetRoas: { id: string; name: string; abbreviation: string | null }[];
  events: Marker[];
  /** Highest phase across the asset's trials; shown as a chip. */
  leadPhase: string | null;
  isFirstInCompany: boolean;
  isLastInCompany: boolean;
}

export type TrialGridRow = FlattenedTrial & { kind: 'trial' };

export type GridRow = CompanyBandRow | AssetLaneRow | TrialGridRow;

/** Highest clinical phase across an asset's trials, by phase rank. Null when none. */
export function assetLeadPhase(trials: Trial[]): string | null {
  let best: string | null = null;
  let bestRank = -Infinity;
  for (const t of trials) {
    const phase = t.phase_type;
    if (!phase) continue;
    const rank = phaseOrder(phase);
    if (rank > bestRank) {
      bestRank = rank;
      best = phase;
    }
  }
  return best;
}

@Component({
  selector: 'app-dashboard-grid',
  imports: [
    BrandLogoComponent,
    ChangeBadgeComponent,
    GridHeaderComponent,
    MarkerComponent,
    PhaseBarComponent,
    PiMarkComponent,
    TooltipModule,
  ],
  templateUrl: './dashboard-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardGridComponent implements AfterViewInit {
  private readonly timeline = inject(TimelineService);
  private readonly elRef = inject(ElementRef);
  private readonly landscapeState = inject(LandscapeStateService, { optional: true });
  private readonly scrollContainerEl = signal<HTMLElement | null>(null);

  readonly companies = input.required<Company[]>();
  readonly zoomLevel = input.required<ZoomLevel>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();

  readonly hideCompanyColumn = input<boolean>(false);
  readonly hideAssetColumn = input<boolean>(false);
  readonly hideTrialColumn = input<boolean>(false);
  readonly hideMoaColumn = input<boolean>(false);
  readonly hideRoaColumn = input<boolean>(false);
  readonly hideIndicationColumn = input<boolean>(false);

  /**
   * Timeline-scoped density control (default on). When on, a trial that owns
   * published primary intelligence renders its PI headline as an inline second
   * line under the trial name; when off, the row collapses to just the bookmark
   * mark beside the name, reclaiming vertical density for the dense view.
   */
  readonly showIntelligenceHeadlines = input<boolean>(true);

  readonly phaseClick = output<Trial>();
  readonly markerClick = output<Marker>();
  readonly trialClick = output<Trial>();
  readonly companyClick = output<string>();
  readonly assetClick = output<string>();

  /**
   * Row the pointer is over, tracked by key so the frozen label pane and the
   * timeline area -- two separate DOM subtrees -- highlight the same row in
   * sync. Set on row mouseenter; cleared when the pointer leaves the scroller.
   * Gives the eye a single focused row across the full width (label + markers).
   */
  readonly hoveredRowKey = signal<string | null>(null);
  protected isRowHovered(row: GridRow): boolean {
    return this.hoveredRowKey() === this.rowKey(row);
  }

  /**
   * Hovered-row treatment, split by what each half holds. The frozen label pane
   * has no data to obscure, so it gets a faint brand wash. The timeline half
   * holds the phase bars and markers, so it gets only a light brand outline
   * (inset shadow: top/bottom/right) -- no fill -- and the data reads through
   * untouched. Inset shadow adds no layout shift; the two halves join into one
   * row at the pane divider.
   */
  private static readonly HOVER_EDGE =
    'color-mix(in srgb, var(--color-brand-500, #14b8a6) 38%, transparent)';
  protected readonly hoverWash =
    'color-mix(in srgb, var(--color-brand-500, #14b8a6) 7%, transparent)';
  protected readonly hoverShadowRight = `inset 0 1px 0 0 ${DashboardGridComponent.HOVER_EDGE}, inset 0 -1px 0 0 ${DashboardGridComponent.HOVER_EDGE}, inset -1px 0 0 0 ${DashboardGridComponent.HOVER_EDGE}`;
  readonly showMoaColumn = computed(() => this.landscapeState?.showMoaColumn() ?? true);
  readonly showRoaColumn = computed(() => this.landscapeState?.showRoaColumn() ?? true);
  readonly showIndicationColumn = computed(
    () => this.landscapeState?.showIndicationColumn() ?? false
  );

  // Detail level (company > asset > trial depth) drives row visibility. Company
  // bands always render; 'assets' adds asset rows (the old Compare); 'trials'
  // adds trial detail. Optional service fallback keeps embedded/export grids
  // (no LandscapeStateService) at full detail.
  readonly detailLevel = computed<DetailLevel>(() => this.landscapeState?.detailLevel() ?? 'trials');
  /** Asset header rows render at 'assets' and 'trials' depth, not at 'companies'. */
  readonly showAssetRows = computed(() => this.detailLevel() !== 'companies');
  /** Trial rows render only at full 'trials' depth. */
  readonly showTrials = computed(() => this.detailLevel() === 'trials');
  /** Asset-level event glyphs show wherever asset rows are present. */
  readonly showAssetEvents = computed(() => this.showAssetRows());

  /**
   * Vertical density. Comfortable keeps the established rhythm; compact tightens
   * each row and (via the compact flag threaded to markers and phase bars)
   * shrinks the glyphs so more programs fit per screen while date captions stay.
   */
  readonly density = computed<GridDensity>(() => this.landscapeState?.density() ?? 'comfortable');
  readonly compact = computed(() => this.density() === 'compact');
  readonly rowHeight = computed(() => (this.compact() ? 30 : 36));

  /** Vertical room a trial row gains so its intelligence-headline second line breathes. */
  private static readonly HEADLINE_ROW_EXTRA_PX = 14;

  /** Vertical room an asset row gains for its labeled MOA/ROA attribute line. */
  private static readonly ATTR_ROW_EXTRA_PX = 13;

  /**
   * The company band is a section header, not a data row, so it gets extra height
   * to give the logo + tracked company name room to breathe rather than sitting
   * cramped between the company divider above and the first asset below. The extra
   * scales with density so compact tightens the section headers too.
   */
  private companyRowExtraPx(): number {
    return this.compact() ? 2 : 6;
  }

  /** A trial row that is currently rendering its intelligence-headline second line. */
  protected hasVisibleHeadline(row: GridRow): boolean {
    return (
      row.kind === 'trial' &&
      this.showIntelligenceHeadlines() &&
      !!row.trial.has_intelligence &&
      !!row.trial.intelligence_headline
    );
  }

  /**
   * Per-row height. The headline rows grow by a fixed amount so the second line
   * is not crammed against the row divider; the markers and phase bar stay in the
   * base-height top band (the extra height is padding below them), and both panes
   * use this same value so rows stay aligned across the frozen/timeline split.
   */
  protected rowHeightFor(row: GridRow): number {
    if (row.kind === 'company') {
      return this.rowHeight() + this.companyRowExtraPx();
    }
    if (this.assetHasAttributesLine(row)) {
      return this.rowHeight() + DashboardGridComponent.ATTR_ROW_EXTRA_PX;
    }
    return (
      this.rowHeight() +
      (this.hasVisibleHeadline(row) ? DashboardGridComponent.HEADLINE_ROW_EXTRA_PX : 0)
    );
  }

  constructor() {
    // On load (and when the data/range changes) anchor the horizontal scroll on
    // "today" so the user lands on current and upcoming activity rather than the
    // empty early years. See computeInitialScrollLeft for the anchoring rules.
    effect(() => {
      const el = this.scrollContainerEl();
      const lastX = this.lastEventX();
      const todayX = this.todayX();
      const contentWidth = this.totalWidth();
      if (!el || lastX === null) return;

      requestAnimationFrame(() => {
        // The frozen label pane (Asset/MOA/ROA/Trial) is sticky inside the same
        // scroller, so only `clientWidth - frozenWidth` of the viewport actually
        // shows timeline. Anchor against that effective width, not the full one.
        const frozen = el.querySelector<HTMLElement>('.sticky');
        const frozenWidth = frozen ? frozen.getBoundingClientRect().width : 0;
        el.scrollLeft = computeInitialScrollLeft({
          todayX,
          lastEventX: lastX,
          viewportWidth: Math.max(0, el.clientWidth - frozenWidth),
          contentWidth,
        });
      });
    });
  }

  readonly columns = computed<TimelineColumn[]>(() =>
    this.timeline.getColumns(this.startYear(), this.endYear(), this.zoomLevel())
  );

  readonly totalWidth = computed<number>(() =>
    this.timeline.getTimelineWidth(this.startYear(), this.endYear(), this.zoomLevel())
  );

  /** Pixel x-position of "today" within the timeline content. */
  readonly todayX = computed<number>(() => {
    const today = new Date().toISOString().split('T')[0];
    return this.timeline.dateToX(today, this.startYear(), this.endYear(), this.totalWidth());
  });

  /** Today's x-position when it falls within the rendered range, else null (hides the marker). */
  readonly todayMarkerX = computed<number | null>(() => {
    const x = this.todayX();
    return x >= 0 && x <= this.totalWidth() ? x : null;
  });

  /** Pixel x-position of the latest event across all rendered rows. */
  private readonly lastEventX = computed<number | null>(() => {
    const rows = this.gridRows();
    if (rows.length === 0) return null;

    let latestMs = -Infinity;
    for (const row of rows) {
      const events = row.kind === 'trial' ? (row.trial.markers ?? []) : row.events;
      for (const event of events) {
        const t = new Date(event.event_date).getTime();
        if (t > latestMs) latestMs = t;
      }
    }

    if (latestMs === -Infinity) return null;

    const dateStr = new Date(latestMs).toISOString().split('T')[0];
    return this.timeline.dateToX(dateStr, this.startYear(), this.endYear(), this.totalWidth());
  });

  /**
   * The ordered render list across all three row levels. For each company: a
   * company header band (whenever the company toggle is on, regardless of whether
   * it owns events), then each asset's header lane, then the asset's trial rows
   * (when the Trials toggle is on). isFirstInCompany marks the first rendered row
   * of a company; isLastInCompany marks the last (the heavy divider).
   */
  readonly gridRows = computed<GridRow[]>(() => {
    const rows: GridRow[] = [];
    const showAssetRows = this.showAssetRows();
    const showTrials = this.showTrials();

    for (const company of this.companies()) {
      const companyStartLen = rows.length;
      let isFirstInCompany = true;

      // Company bands always render -- the company is the top of the hierarchy
      // and the grouping header at every detail level. Company events render on
      // this band's lane.
      const companyEvents = (company.events ?? []).filter((e) => effectiveVisibility(e));
      rows.push({
        kind: 'company',
        companyId: company.id,
        companyName: company.name,
        companyLogoUrl: company.logo_url ?? null,
        companyHasIntelligence: company.has_intelligence ?? false,
        companyIntelligenceHeadline: company.intelligence_headline ?? null,
        events: companyEvents,
        isFirstInCompany,
        isLastInCompany: false,
      });
      isFirstInCompany = false;

      for (const asset of company.assets ?? []) {
        // 'companies' detail level shows company bands only -- no asset rows.
        if (!showAssetRows) break;
        const trials = asset.trials ?? [];
        // Asset header is structural at 'assets'/'trials' depth: the asset's
        // identity + level attributes (MOA/ROA) + asset-anchored events.
        const assetEvents = (asset.events ?? []).filter((e) => effectiveVisibility(e));
        rows.push({
          kind: 'asset',
          companyId: company.id,
          companyName: company.name,
          companyLogoUrl: company.logo_url ?? null,
          assetId: asset.id,
          assetName: asset.name,
          assetLogoUrl: asset.logo_url ?? null,
          assetHasIntelligence: asset.has_intelligence ?? false,
          assetIntelligenceHeadline: asset.intelligence_headline ?? null,
          assetMoas: asset.mechanisms_of_action ?? [],
          assetRoas: asset.routes_of_administration ?? [],
          events: assetEvents,
          leadPhase: assetLeadPhase(trials),
          isFirstInCompany,
          isLastInCompany: false,
        });
        isFirstInCompany = false;

        if (showTrials) {
          let isFirstInAsset = true;
          for (const trial of trials) {
            rows.push({
              kind: 'trial',
              companyName: company.name,
              companyId: company.id,
              companyLogoUrl: company.logo_url ?? null,
              assetName: asset.name,
              assetId: asset.id,
              assetLogoUrl: asset.logo_url ?? null,
              assetMoas: asset.mechanisms_of_action ?? [],
              assetRoas: asset.routes_of_administration ?? [],
              trialIndications: (trial._indications ?? []).map((i) => ({
                id: i.indication_id,
                name: i.indication_name,
              })),
              trial,
              phaseSpan: deriveTrialPhaseSpan(trial.markers ?? []),
              isFirstInCompany,
              isFirstInAsset,
              isLastInCompany: false,
              companyHasIntelligence: company.has_intelligence ?? false,
              companyIntelligenceHeadline: company.intelligence_headline ?? null,
              assetHasIntelligence: asset.has_intelligence ?? false,
              assetIntelligenceHeadline: asset.intelligence_headline ?? null,
            });
            isFirstInCompany = false;
            isFirstInAsset = false;
          }
        }
      }

      if (rows.length > companyStartLen) {
        rows[rows.length - 1].isLastInCompany = true;
      }
    }
    return rows;
  });

  /** Trial rows only -- backs the caption-layout and scroll computeds. */
  readonly flattenedTrials = computed<TrialGridRow[]>(() =>
    this.gridRows().filter((r): r is TrialGridRow => r.kind === 'trial')
  );

  /** Stable @for key across the three row kinds. */
  protected rowKey(row: GridRow): string {
    return row.kind === 'trial'
      ? `t:${row.trial.id}`
      : row.kind === 'asset'
        ? `a:${row.assetId}`
        : `c:${row.companyId}`;
  }

  /**
   * Lead-phase chip dot/label/text. The chip mirrors the heatmap + bullseye
   * standard: a light pill with a phase-hued dot and phase-colored label, rather
   * than a solid phase-colored fill. The dot carries the raw hue; the text is
   * darkened to the AA contrast floor on the light chip (the muted early-phase
   * slates fail as plain text otherwise).
   */
  protected phaseChipColor(phase: string): string {
    return PHASE_COLORS[phase] ?? PHASE_FALLBACK_COLOR;
  }

  protected phaseChipTextColor(phase: string): string {
    return textColorOnWhite(this.phaseChipColor(phase));
  }

  protected phaseChipLabel(phase: string): string {
    return phaseShortLabel(phase);
  }

  /**
   * Start captions are centered on the icon; two whose centers are closer than
   * this overlap and turn to garble at year zoom. Suppressed captions remain
   * available via the marker tooltip.
   */
  private static readonly DATE_LABEL_MIN_GAP_PX = 38;

  /** Clearance kept between a range end-cap caption and any other caption. */
  private static readonly END_LABEL_PAD_PX = 3;

  /** End-cap caption text is left-anchored at `tailEndX - 12` (see template). */
  private static readonly END_LABEL_OFFSET_PX = 12;

  /** The markers/events a row carries: trial markers, or band/lane events. */
  private rowMarkers(row: GridRow): Marker[] {
    return row.kind === 'trial' ? (row.trial.markers ?? []) : row.events;
  }

  /**
   * Per row (trial, asset lane, or company band), the caption keys allowed to
   * render. Start captions use the marker id; the secondary range end-cap
   * caption uses `<id>:end`. Start captions win their slots first (greedy by x);
   * end-cap captions render only where they clear every kept caption -- they are
   * width-aware because their left-anchored text can be wider than the start
   * container and lands at the tail end, not under the icon. Keyed by `rowKey`
   * so band/lane events de-collide identically to trial markers.
   */
  private readonly visibleDateLabels = computed<Map<string, Set<string>>>(() => {
    const sy = this.startYear();
    const ey = this.endYear();
    const tw = this.totalWidth();
    const map = new Map<string, Set<string>>();
    for (const row of this.gridRows()) {
      const markers = this.rowMarkers(row);
      if (markers.length === 0) continue;
      const inWindow = markers.filter((m) => this.isMarkerInWindow(m));

      const startX = new Map<string, number>();
      for (const m of inWindow) {
        startX.set(m.id, this.timeline.dateToX(m.event_date, sy, ey, tw));
      }

      const startKept = visibleLabelMarkerIds(
        inWindow.map((m) => ({ id: m.id, x: startX.get(m.id) ?? 0 })),
        DashboardGridComponent.DATE_LABEL_MIN_GAP_PX
      );

      // Kept start captions occupy fixed intervals; end-caps must clear them.
      const occupied: CaptionInterval[] = [];
      for (const m of inWindow) {
        if (!startKept.has(m.id)) continue;
        const cx = startX.get(m.id) ?? 0;
        const half = estimateCaptionWidthPx(markerStartCaption(m.event_date, m.date_precision)) / 2;
        occupied.push({ key: m.id, left: cx - half, right: cx + half });
      }

      const endCaps: CaptionInterval[] = [];
      for (const m of inWindow) {
        const endLabel = this.endCapLabel(m, sy, ey, tw, startX.get(m.id) ?? 0);
        if (!endLabel) continue;
        const left = endLabel.anchorX - DashboardGridComponent.END_LABEL_OFFSET_PX;
        endCaps.push({ key: `${m.id}:end`, left, right: left + endLabel.width });
      }

      const kept = new Set(startKept);
      for (const key of placeOptionalCaptions(
        occupied,
        endCaps,
        DashboardGridComponent.END_LABEL_PAD_PX
      )) {
        kept.add(key);
      }
      map.set(this.rowKey(row), kept);
    }
    return map;
  });

  /**
   * The visible end-cap caption for a bounded, fuzzy-ended range (mirrors the
   * marker template gate: a tail longer than the icon, not ongoing, with a
   * fuzzy end period). Returns the tail-end anchor x and estimated text width,
   * or null when no end-cap caption renders.
   */
  private endCapLabel(
    m: Marker,
    sy: number,
    ey: number,
    tw: number,
    sx: number
  ): { anchorX: number; width: number } | null {
    if (m.is_ongoing || !m.end_date) return null;
    const period = markerPeriodLabel(m.end_date, m.end_date_precision);
    if (!period) return null;
    const endX = Math.min(tw, this.timeline.dateToX(m.end_date, sy, ey, tw));
    if (endX - sx <= MARKER_ICON_SIZE) return null;
    return { anchorX: endX, width: estimateCaptionWidthPx(`~${period}`) };
  }

  protected dateLabelVisible(rowKey: string, markerId: string): boolean {
    return this.visibleDateLabels().get(rowKey)?.has(markerId) ?? true;
  }

  protected endLabelVisible(rowKey: string, markerId: string): boolean {
    return this.visibleDateLabels().get(rowKey)?.has(`${markerId}:end`) ?? true;
  }

  ngAfterViewInit(): void {
    const scrollEl = this.elRef.nativeElement.querySelector(
      '.overflow-x-auto'
    ) as HTMLElement | null;
    if (scrollEl) {
      this.scrollContainerEl.set(scrollEl);
    }
  }

  hasSubColumns(): boolean {
    return this.columns().some((c) => c.subColumns && c.subColumns.length > 0);
  }

  onPhaseClick(trial: Trial): void {
    this.phaseClick.emit(trial);
  }

  onMarkerClick(marker: Marker): void {
    this.markerClick.emit(marker);
  }

  onTrialClick(trial: Trial): void {
    this.trialClick.emit(trial);
  }

  onCompanyClick(companyId: string): void {
    this.companyClick.emit(companyId);
  }

  onAssetClick(assetId: string): void {
    this.assetClick.emit(assetId);
  }

  moaTooltipText(moas: { id: string; name: string }[]): string {
    return moas.map((m) => m.name).join(' \u00B7 ');
  }

  roaTooltipText(roas: { id: string; name: string; abbreviation: string | null }[]): string {
    return roas.map((r) => r.name).join(' \u00B7 ');
  }

  /** Inline route list (abbreviations preferred) for the asset attribute line. */
  roaInlineText(roas: { id: string; name: string; abbreviation: string | null }[]): string {
    return roas.map((r) => r.abbreviation ?? r.name).join(', ');
  }

  /**
   * True when an asset row should render its second (attribute) line -- i.e. it
   * has MOA or ROA to show and the column is toggled on. Drives the row-height
   * bump so the labeled attribute line never crowds the asset name.
   */
  protected assetHasAttributesLine(row: GridRow): boolean {
    if (row.kind !== 'asset') return false;
    const moa = this.showMoaColumn() && !this.hideMoaColumn() && row.assetMoas.length > 0;
    const roa = this.showRoaColumn() && !this.hideRoaColumn() && row.assetRoas.length > 0;
    return moa || roa;
  }

  indicationTooltipText(indications: { id: string; name: string }[]): string {
    return indications.map((i) => i.name).join(' \u00B7 ');
  }

  /** Inline indication list for the labeled trial-row treatment (shows all, not +N). */
  indicationInlineText(indications: { id: string; name: string }[]): string {
    return indications.map((i) => i.name).join(', ');
  }

  protected isMarkerInWindow(marker: Marker): boolean {
    const year = new Date(marker.event_date).getFullYear();
    return year >= this.startYear() && year <= this.endYear();
  }
}
