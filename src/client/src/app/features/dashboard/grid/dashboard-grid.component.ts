import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { Marker } from '../../../core/models/marker.model';
import { Trial } from '../../../core/models/trial.model';
import { TimelineColumn, TimelineService } from '../../../core/services/timeline.service';
import { deriveTrialPhaseSpan, TrialPhaseSpan } from '../../../core/models/trial-phase-span';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { markerPeriodLabel, markerStartCaption } from '../../../core/models/marker-date-precision';
import { MARKER_ICON_SIZE } from '../../../shared/utils/grid-constants';
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
export class DashboardGridComponent implements AfterViewInit, OnDestroy {
  private readonly timeline = inject(TimelineService);
  private readonly elRef = inject(ElementRef);
  private readonly landscapeState = inject(LandscapeStateService, { optional: true });
  private scrollListener: (() => void) | null = null;
  private scrollRafId: number | null = null;
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

  readonly isScrolled = signal(false);
  // The scroll position the timeline auto-anchors to on load ("today"). The
  // company column collapses to a logo only once the user scrolls AWAY from
  // this home position, so the default today view keeps the company name (and
  // its intelligence mark) visible rather than collapsing immediately.
  private homeScrollLeft = 0;
  readonly showMoaColumn = computed(() => this.landscapeState?.showMoaColumn() ?? true);
  readonly showRoaColumn = computed(() => this.landscapeState?.showRoaColumn() ?? true);
  readonly showIndicationColumn = computed(
    () => this.landscapeState?.showIndicationColumn() ?? false
  );

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
        // Record where "home" landed (read back the clamped value) and treat it
        // as not-scrolled, so the company column stays expanded at the default
        // today anchor and only collapses once the user scrolls away from here.
        this.homeScrollLeft = el.scrollLeft;
        this.isScrolled.set(false);
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

  /** Pixel x-position of the latest marker event across all trials. */
  private readonly lastEventX = computed<number | null>(() => {
    const trials = this.flattenedTrials();
    if (trials.length === 0) return null;

    let latestMs = -Infinity;
    for (const row of trials) {
      for (const marker of row.trial.markers ?? []) {
        const t = new Date(marker.event_date).getTime();
        if (t > latestMs) latestMs = t;
      }
    }

    if (latestMs === -Infinity) return null;

    const dateStr = new Date(latestMs).toISOString().split('T')[0];
    return this.timeline.dateToX(dateStr, this.startYear(), this.endYear(), this.totalWidth());
  });

  readonly flattenedTrials = computed<FlattenedTrial[]>(() => {
    const rows: FlattenedTrial[] = [];
    for (const company of this.companies()) {
      let isFirstInCompany = true;
      const assets = company.assets ?? [];
      for (const asset of assets) {
        let isFirstInAsset = true;
        const trials = asset.trials ?? [];
        for (const trial of trials) {
          rows.push({
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
      if (rows.length > 0) {
        rows[rows.length - 1].isLastInCompany = true;
      }
    }
    return rows;
  });

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

  /**
   * Per trial row, the caption keys allowed to render. Start captions use the
   * marker id; the secondary range end-cap caption uses `<id>:end`. Start
   * captions win their slots first (greedy by x); end-cap captions render only
   * where they clear every kept caption -- they are width-aware because their
   * left-anchored text can be wider than the start container and lands at the
   * tail end, not under the icon.
   */
  private readonly visibleDateLabels = computed<Map<string, Set<string>>>(() => {
    const sy = this.startYear();
    const ey = this.endYear();
    const tw = this.totalWidth();
    const map = new Map<string, Set<string>>();
    for (const row of this.flattenedTrials()) {
      const inWindow = (row.trial.markers ?? []).filter((m) => this.isMarkerInWindow(m));

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
      map.set(row.trial.id, kept);
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

  protected dateLabelVisible(trialId: string, markerId: string): boolean {
    return this.visibleDateLabels().get(trialId)?.has(markerId) ?? true;
  }

  protected endLabelVisible(trialId: string, markerId: string): boolean {
    return this.visibleDateLabels().get(trialId)?.has(`${markerId}:end`) ?? true;
  }

  ngAfterViewInit(): void {
    const scrollEl = this.elRef.nativeElement.querySelector(
      '.overflow-x-auto'
    ) as HTMLElement | null;
    if (scrollEl) {
      this.scrollContainerEl.set(scrollEl);
      this.scrollListener = () => {
        if (this.scrollRafId !== null) return;
        this.scrollRafId = requestAnimationFrame(() => {
          // Relative to the auto-anchored home position, not absolute 0, so the
          // initial programmatic scroll-to-today does not count as "scrolled".
          this.isScrolled.set(Math.abs(scrollEl.scrollLeft - this.homeScrollLeft) > 50);
          this.scrollRafId = null;
        });
      };
      scrollEl.addEventListener('scroll', this.scrollListener, { passive: true });
    }
  }

  ngOnDestroy(): void {
    if (this.scrollListener) {
      const scrollEl = this.elRef.nativeElement.querySelector('.overflow-x-auto');
      scrollEl?.removeEventListener('scroll', this.scrollListener);
    }
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
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

  indicationTooltipText(indications: { id: string; name: string }[]): string {
    return indications.map((i) => i.name).join(' \u00B7 ');
  }

  protected isMarkerInWindow(marker: Marker): boolean {
    const year = new Date(marker.event_date).getFullYear();
    return year >= this.startYear() && year <= this.endYear();
  }
}
