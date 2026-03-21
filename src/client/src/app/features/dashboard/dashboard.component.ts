import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { DashboardFilters, ZoomLevel } from '../../core/models/dashboard.model';
import { TrialMarker } from '../../core/models/marker.model';
import { Trial, TrialPhase } from '../../core/models/trial.model';
import { DashboardService } from '../../core/services/dashboard.service';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { ExportDialogComponent } from './export-dialog/export-dialog.component';
import { DashboardGridComponent } from './grid/dashboard-grid.component';
import { FilterPanelComponent } from './filter-panel/filter-panel.component';
import { LegendComponent } from './legend/legend.component';
import { ZoomControlComponent } from './zoom-control/zoom-control.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    DashboardGridComponent,
    ExportDialogComponent,
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
  private readonly route = inject(ActivatedRoute);

  readonly tenantId = signal('');
  readonly spaceId = signal('');

  filters = signal<DashboardFilters>({
    companyIds: null,
    productIds: null,
    therapeuticAreaIds: null,
    startYear: null,
    endYear: null,
    recruitmentStatuses: null,
    studyTypes: null,
    phases: null,
  });

  zoomLevel = signal<ZoomLevel>('yearly');
  startYear = signal(2016);
  endYear = signal(2026);

  private seeded = false;

  dashboardData = resource({
    request: () => ({ filters: this.filters(), spaceId: this.spaceId() }),
    loader: async ({ request }) => {
      if (!request.spaceId) return { companies: [] };
      const data = await this.dashboardService.getDashboardData(request.spaceId, request.filters);
      if (!this.seeded && data.companies.length === 0) {
        this.seeded = true;
        await this.dashboardService.seedDemoData(request.spaceId);
        return await this.dashboardService.getDashboardData(request.spaceId, request.filters);
      }
      return data;
    },
  });

  companies = computed(() => this.dashboardData.value()?.companies ?? []);
  exportDialogOpen = signal(false);

  constructor() {
    const params = this.route.snapshot.paramMap;
    this.tenantId.set(params.get('tenantId') ?? '');
    this.spaceId.set(params.get('spaceId') ?? '');

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
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'manage',
      'trials',
      phase.trial_id,
    ]);
  }

  onMarkerClick(marker: TrialMarker): void {
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'manage',
      'trials',
      marker.trial_id,
    ]);
  }

  onTrialClick(trial: Trial): void {
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'manage',
      'trials',
      trial.id,
    ]);
  }

  onCompanyClick(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'companies']);
  }

  onProductClick(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'products']);
  }

  retry(): void {
    this.dashboardData.reload();
  }
}
