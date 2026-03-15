import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { Router } from '@angular/router';

import { DashboardFilters, ZoomLevel } from '../../core/models/dashboard.model';
import { TrialMarker } from '../../core/models/marker.model';
import { TrialPhase } from '../../core/models/trial.model';
import { DashboardService } from '../../core/services/dashboard.service';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { DashboardGridComponent } from './grid/dashboard-grid.component';
import { FilterPanelComponent } from './filter-panel/filter-panel.component';
import { LegendComponent } from './legend/legend.component';
import { ZoomControlComponent } from './zoom-control/zoom-control.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    DashboardGridComponent,
    FilterPanelComponent,
    LegendComponent,
    ZoomControlComponent,
    ButtonModule,
    MessageModule,
    ProgressSpinner,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly dashboardService = inject(DashboardService);
  private readonly router = inject(Router);

  filters = signal<DashboardFilters>({
    companyIds: null,
    productIds: null,
    therapeuticAreaIds: null,
    startYear: null,
    endYear: null,
  });

  zoomLevel = signal<ZoomLevel>('yearly');
  startYear = signal(2016);
  endYear = signal(2026);

  dashboardData = resource({
    request: () => this.filters(),
    loader: async ({ request: filters }) => {
      return await this.dashboardService.getDashboardData(filters);
    },
  });

  constructor() {
    effect(() => {
      const data = this.dashboardData.value();
      if (!data || !data.companies.length) return;

      let minYear = Infinity;
      let maxYear = -Infinity;

      for (const company of data.companies) {
        for (const product of company.products ?? []) {
          for (const trial of product.trials ?? []) {
            for (const phase of trial.trial_phases ?? []) {
              const sy = new Date(phase.start_date).getFullYear();
              if (sy < minYear) minYear = sy;
              if (phase.end_date) {
                const ey = new Date(phase.end_date).getFullYear();
                if (ey > maxYear) maxYear = ey;
              }
            }
            for (const marker of trial.trial_markers ?? []) {
              const my = new Date(marker.event_date).getFullYear();
              if (my < minYear) minYear = my;
              if (my > maxYear) maxYear = my;
            }
          }
        }
      }

      if (minYear !== Infinity) {
        this.startYear.set(minYear - 1);
        this.endYear.set(Math.max(maxYear + 1, new Date().getFullYear() + 1));
      }
    });
  }

  onFiltersChange(filters: DashboardFilters): void {
    this.filters.set(filters);
  }

  onZoomChange(zoom: ZoomLevel): void {
    this.zoomLevel.set(zoom);
  }

  onPhaseClick(phase: TrialPhase): void {
    this.router.navigate(['/manage/trials', phase.trial_id]);
  }

  onMarkerClick(marker: TrialMarker): void {
    this.router.navigate(['/manage/trials', marker.trial_id]);
  }

  retry(): void {
    this.dashboardData.reload();
  }
}
