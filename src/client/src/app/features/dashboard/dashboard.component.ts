import { Component, inject, resource, signal } from '@angular/core';
import { Router } from '@angular/router';

import { DashboardFilters, ZoomLevel } from '../../core/models/dashboard.model';
import { TrialMarker } from '../../core/models/marker.model';
import { TrialPhase } from '../../core/models/trial.model';
import { DashboardService } from '../../core/services/dashboard.service';
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

  zoomLevel = signal<ZoomLevel>('quarterly');
  startYear = signal(2020);
  endYear = signal(2026);

  dashboardData = resource({
    request: () => this.filters(),
    loader: async ({ request: filters }) => {
      return await this.dashboardService.getDashboardData(filters);
    },
  });

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
