import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Marker } from '../../core/models/marker.model';
import { Trial } from '../../core/models/trial.model';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
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
    SkeletonComponent,
  ],
  templateUrl: './timeline-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineViewComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');

  /** Optional caller-supplied window. When null, the component auto-fits to data. */
  readonly startYear = input<number | null>(null);
  readonly endYear = input<number | null>(null);

  private readonly autoStartYear = signal(2016);
  private readonly autoEndYear = signal(2026);

  readonly resolvedStartYear = computed(() => this.startYear() ?? this.autoStartYear());
  readonly resolvedEndYear = computed(() => this.endYear() ?? this.autoEndYear());

  readonly exportDialogOpen = signal(false);
  readonly companies = computed(() => this.state.filteredCompanies());
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const exportHandler = () => {
      if (this.companies().length > 0) {
        this.exportDialogOpen.set(true);
      }
    };
    document.addEventListener('landscape:export', exportHandler);
    destroyRef.onDestroy(() => document.removeEventListener('landscape:export', exportHandler));

    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }

    effect(() => {
      // Skip auto-fit when caller provides both year inputs.
      if (this.startYear() !== null && this.endYear() !== null) return;

      const companies = this.companies();
      if (!companies.length) return;

      let minYear = Infinity;
      let maxYear = -Infinity;

      for (const company of companies) {
        for (const product of company.products ?? []) {
          for (const trial of product.trials ?? []) {
            if (trial.phase_start_date) {
              const sy = new Date(trial.phase_start_date).getFullYear();
              if (sy < minYear) minYear = sy;
            }
            if (trial.phase_end_date) {
              const ey = new Date(trial.phase_end_date).getFullYear();
              if (ey > maxYear) maxYear = ey;
            }
            for (const marker of trial.markers ?? []) {
              const my = new Date(marker.event_date).getFullYear();
              if (my < minYear) minYear = my;
              if (my > maxYear) maxYear = my;
            }
          }
        }
      }

      if (minYear !== Infinity) {
        this.autoStartYear.set(minYear - 1);
        this.autoEndYear.set(Math.max(maxYear + 1, new Date().getFullYear() + 1));
      }
    });
  }

  onPhaseClick(trial: Trial): void {
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

  onMarkerClick(marker: Marker): void {
    this.state.selectMarker(marker.id);
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

  onCompanyClick(companyId: string): void {
    if (!companyId) return;
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'manage',
      'companies',
      companyId,
    ]);
  }

  onAssetClick(assetId: string): void {
    if (!assetId) return;
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'assets', assetId]);
  }

  retry(): void {
    this.state.reload();
  }
}
