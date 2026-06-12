import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Marker } from '../../core/models/marker.model';
import { Trial } from '../../core/models/trial.model';
import { PptxExportService } from '../../core/services/pptx-export.service';
import { TenantService } from '../../core/services/tenant.service';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { XlsxExportService } from '../../core/services/xlsx-export.service';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import type { ExportAction } from '../../shared/export/export-button.component';
import { createTopbarExportSync } from '../../shared/export/topbar-export-sync';
import { DashboardGridComponent } from '../dashboard/grid/dashboard-grid.component';
import { PngExportService } from '../dashboard/export/png-export.service';
import { LegendComponent } from '../dashboard/legend/legend.component';
import { LandscapeStateService } from './landscape-state.service';
import { TimelineInsightStripComponent } from './timeline-insight-strip.component';
import { MarkWatermarkComponent } from '../../shared/components/watermark/mark-watermark.component';

@Component({
  selector: 'app-timeline-view',
  imports: [
    ButtonModule,
    DashboardGridComponent,
    LegendComponent,
    MarkWatermarkComponent,
    MessageModule,
    SkeletonComponent,
    TimelineInsightStripComponent,
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

  readonly hideCompanyColumn = input<boolean>(false);
  readonly hideAssetColumn = input<boolean>(false);
  readonly hideTrialColumn = input<boolean>(false);
  readonly hideMoaColumn = input<boolean>(false);
  readonly hideRoaColumn = input<boolean>(false);
  readonly hideNotesColumn = input<boolean>(false);
  readonly hideLegend = input<boolean>(false);
  readonly legendVisible = input<boolean>(false);
  readonly columnsOnly = input<boolean>(false);

  private readonly autoStartYear = signal(2016);
  private readonly autoEndYear = signal(2026);

  readonly resolvedStartYear = computed(() => this.startYear() ?? this.autoStartYear());
  readonly resolvedEndYear = computed(() => this.endYear() ?? this.autoEndYear());

  private readonly xlsxService = inject(XlsxExportService);
  private readonly pptxService = inject(PptxExportService);
  private readonly pngService = inject(PngExportService);
  private readonly tenantService = inject(TenantService);
  private readonly topbarState = inject(TopbarStateService);
  /**
   * Handed to PngExportService so the off-screen grid resolves the same
   * LandscapeStateService instance (providedIn: 'any') as the live view.
   */
  private readonly injector = inject(Injector);

  readonly companies = computed(() => this.state.filteredCompanies());
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];

  /**
   * Header export menu: PNG and Excel capture the timeline as shown; PPTX
   * renders at the current on-screen zoom (no format dialog, no zoom picker).
   * Empty when there is nothing to export. Only the routed landscape timeline
   * publishes these (route data flag); embedded entity-page timelines do not
   * own the topbar.
   */
  readonly exportActions = computed<ExportAction[]>(() => {
    if (this.companies().length === 0) return [];
    return [
      { label: 'PowerPoint', format: 'pptx', run: () => this.exportPptx() },
      { label: 'Image (PNG)', format: 'png', run: () => this.exportPng() },
      { label: 'Excel (XLSX)', format: 'xlsx', run: () => this.xlsxService.exportDashboard(this.companies()) },
    ];
  });

  private readonly exportSync = createTopbarExportSync(this.topbarState);

  constructor() {
    const destroyRef = inject(DestroyRef);
    if (this.route.snapshot.data['publishExportActions']) {
      effect(() => this.exportSync.push(this.exportActions()));
      destroyRef.onDestroy(() => this.exportSync.teardown());
    }

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
        for (const product of company.assets ?? []) {
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

  /**
   * Workspace tenant for the export footer's "Prepared for" segment. Failure
   * degrades the footer to two parties; it never blocks the export.
   */
  private async resolveTenant(): Promise<{ name: string; logoUrl: string | null } | null> {
    if (!this.tenantId()) return null;
    try {
      const t = await this.tenantService.getTenant(this.tenantId());
      return { name: t.name, logoUrl: t.logo_url ?? null };
    } catch {
      return null;
    }
  }

  private async exportPptx(): Promise<void> {
    const tenant = await this.resolveTenant();
    await this.pptxService.exportDashboard(this.companies(), {
      zoomLevel: this.state.zoomLevel(),
      startYear: this.resolvedStartYear(),
      endYear: this.resolvedEndYear(),
      showMoaColumn: this.state.showMoaColumn(),
      showRoaColumn: this.state.showRoaColumn(),
      showNotesColumn: this.state.showNotesColumn(),
      tenant,
    });
  }

  private async exportPng(): Promise<void> {
    const tenant = await this.resolveTenant();
    await this.pngService.exportDashboard(
      {
        companies: this.companies(),
        zoomLevel: this.state.zoomLevel(),
        startYear: this.resolvedStartYear(),
        endYear: this.resolvedEndYear(),
        hideCompanyColumn: this.hideCompanyColumn(),
        hideAssetColumn: this.hideAssetColumn(),
        hideTrialColumn: this.hideTrialColumn(),
        hideMoaColumn: this.hideMoaColumn(),
        hideRoaColumn: this.hideRoaColumn(),
        hideNotesColumn: this.hideNotesColumn(),
        spaceId: this.spaceId(),
        tenantName: tenant?.name ?? '',
        tenantLogoUrl: tenant?.logoUrl ?? null,
      },
      this.injector
    );
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
