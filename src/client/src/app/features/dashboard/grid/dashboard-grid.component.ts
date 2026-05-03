import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
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
  productName: string;
  productId: string;
  productLogoUrl: string | null;
  productMoas: { id: string; name: string }[];
  productRoas: { id: string; name: string; abbreviation: string | null }[];
  trial: Trial;
  isFirstInCompany: boolean;
  isFirstInProduct: boolean;
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
    PhaseBarComponent,
    Popover,
    RowNotesComponent,
  ],
  templateUrl: './dashboard-grid.component.html',
})
export class DashboardGridComponent implements AfterViewInit, OnDestroy {
  private static readonly STORAGE_KEY = 'timeline-column-visibility';

  private timeline = inject(TimelineService);
  private elRef = inject(ElementRef);
  private scrollListener: (() => void) | null = null;
  private scrollRafId: number | null = null;

  companies = input.required<Company[]>();
  zoomLevel = input.required<ZoomLevel>();
  startYear = input.required<number>();
  endYear = input.required<number>();

  phaseClick = output<Trial>();
  markerClick = output<Marker>();
  trialClick = output<Trial>();
  companyClick = output<string>();
  productClick = output<string>();

  isScrolled = signal(false);
  showMoaColumn = signal(true);
  showRoaColumn = signal(true);
  showNotesColumn = signal(true);
  columnSettingsOpen = signal(false);

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
            productMoas: product.mechanisms_of_action ?? [],
            productRoas: product.routes_of_administration ?? [],
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

  onProductClick(productId: string): void {
    this.productClick.emit(productId);
  }

  moaTooltipText(moas: { id: string; name: string }[]): string {
    return moas.map((m) => m.name).join(' \u00B7 ');
  }

  roaTooltipText(roas: { id: string; name: string; abbreviation: string | null }[]): string {
    return roas.map((r) => r.name).join(' \u00B7 ');
  }
}
