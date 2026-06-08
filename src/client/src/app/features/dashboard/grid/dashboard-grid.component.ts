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
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { computeInitialScrollLeft } from './initial-scroll';
import { ChangeBadgeComponent } from '../../../shared/components/change-badge/change-badge.component';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { GridHeaderComponent } from './grid-header.component';
import { MarkerComponent } from './marker.component';
import { PhaseBarComponent } from './phase-bar.component';
import { RowNotesComponent } from './row-notes.component';

export interface FlattenedTrial {
  companyName: string;
  companyId: string;
  companyLogoUrl: string | null;
  assetName: string;
  assetId: string;
  assetLogoUrl: string | null;
  assetMoas: { id: string; name: string }[];
  assetRoas: { id: string; name: string; abbreviation: string | null }[];
  trial: Trial;
  isFirstInCompany: boolean;
  isFirstInAsset: boolean;
  isLastInCompany: boolean;
}

@Component({
  selector: 'app-dashboard-grid',
  imports: [
    BrandLogoComponent,
    ChangeBadgeComponent,
    GridHeaderComponent,
    MarkerComponent,
    PhaseBarComponent,
    RowNotesComponent,
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
  readonly hideNotesColumn = input<boolean>(false);

  readonly phaseClick = output<Trial>();
  readonly markerClick = output<Marker>();
  readonly trialClick = output<Trial>();
  readonly companyClick = output<string>();
  readonly assetClick = output<string>();

  readonly isScrolled = signal(false);
  readonly showMoaColumn = computed(() => this.landscapeState?.showMoaColumn() ?? true);
  readonly showRoaColumn = computed(() => this.landscapeState?.showRoaColumn() ?? true);
  readonly showNotesColumn = computed(() => this.landscapeState?.showNotesColumn() ?? true);

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
        el.scrollLeft = computeInitialScrollLeft({
          todayX,
          lastEventX: lastX,
          viewportWidth: el.clientWidth,
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

  /** Pixel x-position of the latest phase start or marker across all trials. */
  private readonly lastEventX = computed<number | null>(() => {
    const trials = this.flattenedTrials();
    if (trials.length === 0) return null;

    let latestMs = -Infinity;
    for (const row of trials) {
      if (row.trial.phase_start_date) {
        const t = new Date(row.trial.phase_start_date).getTime();
        if (t > latestMs) latestMs = t;
      }
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
            trial,
            isFirstInCompany,
            isFirstInAsset,
            isLastInCompany: false,
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

  ngAfterViewInit(): void {
    const scrollEl = this.elRef.nativeElement.querySelector(
      '.overflow-x-auto'
    ) as HTMLElement | null;
    if (scrollEl) {
      this.scrollContainerEl.set(scrollEl);
      this.scrollListener = () => {
        if (this.scrollRafId !== null) return;
        this.scrollRafId = requestAnimationFrame(() => {
          this.isScrolled.set(scrollEl.scrollLeft > 50);
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

  protected isMarkerInWindow(marker: Marker): boolean {
    const year = new Date(marker.event_date).getFullYear();
    return year >= this.startYear() && year <= this.endYear();
  }
}
