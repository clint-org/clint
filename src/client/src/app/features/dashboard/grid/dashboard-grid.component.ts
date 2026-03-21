import { Component, computed, ElementRef, inject, input, output, signal, AfterViewInit, OnDestroy } from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { TrialMarker } from '../../../core/models/marker.model';
import { Trial, TrialPhase } from '../../../core/models/trial.model';
import { TimelineColumn, TimelineService } from '../../../core/services/timeline.service';
import { GridHeaderComponent } from './grid-header.component';
import { MarkerComponent } from './marker.component';
import { PhaseBarComponent } from './phase-bar.component';
import { RowNotesComponent } from './row-notes.component';

export interface FlattenedTrial {
  companyName: string;
  companyId: string;
  companyLogoUrl: string | null;
  productName: string;
  productId: string;
  productLogoUrl: string | null;
  trial: Trial;
  isFirstInCompany: boolean;
  isFirstInProduct: boolean;
  isLastInCompany: boolean;
}

@Component({
  selector: 'app-dashboard-grid',
  standalone: true,
  imports: [GridHeaderComponent, PhaseBarComponent, MarkerComponent, RowNotesComponent],
  templateUrl: './dashboard-grid.component.html',
})
export class DashboardGridComponent implements AfterViewInit, OnDestroy {
  private timeline = inject(TimelineService);
  private elRef = inject(ElementRef);
  private scrollListener: (() => void) | null = null;

  companies = input.required<Company[]>();
  zoomLevel = input.required<ZoomLevel>();
  startYear = input.required<number>();
  endYear = input.required<number>();

  phaseClick = output<TrialPhase>();
  markerClick = output<TrialMarker>();
  trialClick = output<Trial>();
  companyClick = output<string>();
  productClick = output<string>();

  isScrolled = signal(false);

  columns = computed<TimelineColumn[]>(() =>
    this.timeline.getColumns(this.startYear(), this.endYear(), this.zoomLevel())
  );

  totalWidth = computed<number>(() =>
    this.timeline.getTimelineWidth(this.startYear(), this.endYear(), this.zoomLevel())
  );

  flattenedTrials = computed<FlattenedTrial[]>(() => {
    const rows: FlattenedTrial[] = [];
    for (const company of this.companies()) {
      let isFirstInCompany = true;
      const products = company.products ?? [];
      for (const product of products) {
        let isFirstInProduct = true;
        const trials = product.trials ?? [];
        for (const trial of trials) {
          rows.push({
            companyName: company.name,
            companyId: company.id,
            companyLogoUrl: company.logo_url ?? null,
            productName: product.name,
            productId: product.id,
            productLogoUrl: product.logo_url ?? null,
            trial,
            isFirstInCompany,
            isFirstInProduct,
            isLastInCompany: false,
          });
          isFirstInCompany = false;
          isFirstInProduct = false;
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
        this.isScrolled.set(scrollEl.scrollLeft > 50);
      };
      scrollEl.addEventListener('scroll', this.scrollListener, { passive: true });
    }
  }

  ngOnDestroy(): void {
    if (this.scrollListener) {
      const scrollEl = this.elRef.nativeElement.querySelector('.overflow-x-auto');
      scrollEl?.removeEventListener('scroll', this.scrollListener);
    }
  }

  hasSubColumns(): boolean {
    return this.columns().some(c => c.subColumns && c.subColumns.length > 0);
  }

  onPhaseClick(phase: TrialPhase): void {
    this.phaseClick.emit(phase);
  }

  onMarkerClick(marker: TrialMarker): void {
    this.markerClick.emit(marker);
  }

  onTrialClick(trial: Trial): void {
    this.trialClick.emit(trial);
  }

  onCompanyClick(companyId: string): void {
    this.companyClick.emit(companyId);
  }

  onProductClick(productId: string): void {
    this.productClick.emit(productId);
  }
}
