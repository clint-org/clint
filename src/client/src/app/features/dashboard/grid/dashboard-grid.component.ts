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
import { NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { Marker } from '../../../core/models/marker.model';
import { Trial } from '../../../core/models/trial.model';
import { TimelineColumn, TimelineService } from '../../../core/services/timeline.service';
import { ButtonModule } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Popover } from 'primeng/popover';
import { ChangeBadgeComponent } from '../../../shared/components/change-badge/change-badge.component';
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
  standalone: true,
  imports: [
    ButtonModule,
    ChangeBadgeComponent,
    Checkbox,
    FormsModule,
    GridHeaderComponent,
    MarkerComponent,
    NgOptimizedImage,
    PhaseBarComponent,
    Popover,
    RowNotesComponent,
  ],
  templateUrl: './dashboard-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardGridComponent implements AfterViewInit, OnDestroy {
  private static readonly STORAGE_KEY = 'timeline-column-visibility';

  private timeline = inject(TimelineService);
  private elRef = inject(ElementRef);
  private scrollListener: (() => void) | null = null;
  private scrollRafId: number | null = null;

  readonly companies = input.required<Company[]>();
  readonly zoomLevel = input.required<ZoomLevel>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();

  readonly phaseClick = output<Trial>();
  readonly markerClick = output<Marker>();
  readonly trialClick = output<Trial>();
  readonly companyClick = output<string>();
  readonly assetClick = output<string>();

  readonly isScrolled = signal(false);
  readonly showMoaColumn = signal(true);
  readonly showRoaColumn = signal(true);
  readonly showNotesColumn = signal(true);
  readonly columnSettingsOpen = signal(false);

  constructor() {
    try {
      const stored = sessionStorage.getItem(DashboardGridComponent.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { moa?: boolean; roa?: boolean; notes?: boolean };
        if (typeof parsed.moa === 'boolean') this.showMoaColumn.set(parsed.moa);
        if (typeof parsed.roa === 'boolean') this.showRoaColumn.set(parsed.roa);
        if (typeof parsed.notes === 'boolean') this.showNotesColumn.set(parsed.notes);
      }
    } catch {
      // ignore corrupt data
    }

    effect(() => {
      try {
        sessionStorage.setItem(
          DashboardGridComponent.STORAGE_KEY,
          JSON.stringify({
            moa: this.showMoaColumn(),
            roa: this.showRoaColumn(),
            notes: this.showNotesColumn(),
          })
        );
      } catch {
        // ignore full storage
      }
    });
  }

  readonly columns = computed<TimelineColumn[]>(() =>
    this.timeline.getColumns(this.startYear(), this.endYear(), this.zoomLevel())
  );

  readonly totalWidth = computed<number>(() =>
    this.timeline.getTimelineWidth(this.startYear(), this.endYear(), this.zoomLevel())
  );

  readonly flattenedTrials = computed<FlattenedTrial[]>(() => {
    const rows: FlattenedTrial[] = [];
    for (const company of this.companies()) {
      let isFirstInCompany = true;
      const assets = company.products ?? [];
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
    const scrollEl = this.elRef.nativeElement.querySelector('.overflow-x-auto');
    if (scrollEl) {
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
}
