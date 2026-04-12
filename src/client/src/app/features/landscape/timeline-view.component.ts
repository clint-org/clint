import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Tooltip } from 'primeng/tooltip';

import { DashboardFilters } from '../../core/models/dashboard.model';
import { TrialMarker } from '../../core/models/marker.model';
import { Trial, TrialPhase } from '../../core/models/trial.model';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardGridComponent } from '../dashboard/grid/dashboard-grid.component';
import { ExportDialogComponent } from '../dashboard/export-dialog/export-dialog.component';
import { LegendComponent } from '../dashboard/legend/legend.component';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-timeline-view',
  standalone: true,
  imports: [
    DashboardGridComponent,
    ExportDialogComponent,
    LegendComponent,
    ButtonModule,
    MessageModule,
    ProgressSpinner,
    Tooltip,
  ],
  templateUrl: './timeline-view.component.html',
})
export class TimelineViewComponent {
  private readonly dashboardService = inject(DashboardService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly startYear = signal(2016);
  readonly endYear = signal(2026);
  readonly exportDialogOpen = signal(false);

  private seeded = false;

  /** Build DashboardFilters from shared LandscapeFilters + year range. */
  private readonly dashboardFilters = computed<DashboardFilters>(() => {
    const f = this.state.filters();
    return {
      companyIds: f.companyIds.length ? f.companyIds : null,
      productIds: f.productIds.length ? f.productIds : null,
      therapeuticAreaIds: f.therapeuticAreaIds.length ? f.therapeuticAreaIds : null,
      mechanismOfActionIds: f.mechanismOfActionIds.length ? f.mechanismOfActionIds : null,
      routeOfAdministrationIds: f.routeOfAdministrationIds.length ? f.routeOfAdministrationIds : null,
      recruitmentStatuses: f.recruitmentStatuses.length ? f.recruitmentStatuses : null,
      studyTypes: f.studyTypes.length ? f.studyTypes : null,
      phases: f.phases.length ? (f.phases as string[]) : null,
      startYear: null,
      endYear: null,
    };
  });

  readonly dashboardData = resource({
    request: () => ({
      filters: this.dashboardFilters(),
      spaceId: this.spaceId(),
    }),
    loader: async ({ request }) => {
      if (!request.spaceId) return { companies: [] };
      const data = await this.dashboardService.getDashboardData(
        request.spaceId,
        request.filters,
      );
      if (!this.seeded && data.companies.length === 0) {
        this.seeded = true;
        await this.dashboardService.seedDemoData(request.spaceId);
        return this.dashboardService.getDashboardData(request.spaceId, request.filters);
      }
      return data;
    },
  });

  readonly companies = computed(() => this.dashboardData.value()?.companies ?? []);

  constructor() {
    // Extract route params from ancestor routes
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }

    // Compute year range from data
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

  onPhaseClick(phase: TrialPhase): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', phase.trial_id]);
  }

  onMarkerClick(marker: TrialMarker): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', marker.trial_id]);
  }

  onTrialClick(trial: Trial): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', trial.id]);
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
