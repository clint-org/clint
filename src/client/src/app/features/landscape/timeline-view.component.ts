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
import { ExportNamingService } from '../../shared/export/export-naming.service';
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

@Component({
  selector: 'app-timeline-view',
  imports: [
    ButtonModule,
    DashboardGridComponent,
    LegendComponent,
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
  readonly hideIndicationColumn = input<boolean>(false);
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
  private readonly exportNaming = inject(ExportNamingService);
  private readonly topbarState = inject(TopbarStateService);
  /**
   * Handed to PngExportService so the off-screen grid resolves the same
   * LandscapeStateService instance (providedIn: 'any') as the live view.
   */
  private readonly injector = inject(Injector);

  readonly companies = computed(() => this.state.filteredCompanies());
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];

  /**
   * Timeline-scoped density control (default on), persisted per user via
   * localStorage keyed by space. When on, trial rows that own published primary
   * intelligence render an inline PI headline; when off, only the compact
   * bookmark mark shows, reclaiming vertical density.
   */
  readonly showIntelligenceHeadlines = signal<boolean>(true);
  private readonly headlinePrefKey = computed(() => `clint:pi-headlines:${this.spaceId()}`);

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
      { label: 'Excel (XLSX)', format: 'xlsx', run: () => this.exportXlsx() },
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

    // Hydrate the persisted headline-density preference for this space.
    const storedPref = this.readHeadlinePref();
    if (storedPref !== null) this.showIntelligenceHeadlines.set(storedPref);

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

  private exportFilename(ext: 'png' | 'pptx' | 'xlsx'): Promise<string> {
    return this.exportNaming.filename(this.spaceId(), 'timeline', ext);
  }

  private async exportPptx(): Promise<void> {
    const tenant = await this.resolveTenant();
    await this.pptxService.exportDashboard(this.companies(), {
      zoomLevel: this.state.zoomLevel(),
      startYear: this.resolvedStartYear(),
      endYear: this.resolvedEndYear(),
      showMoaColumn: this.state.showMoaColumn(),
      showRoaColumn: this.state.showRoaColumn(),
      showIndicationColumn: this.state.showIndicationColumn(),
      showNotesColumn: this.state.showNotesColumn(),
      tenant,
      filename: await this.exportFilename('pptx'),
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
        hideIndicationColumn: this.hideIndicationColumn(),
        hideNotesColumn: this.hideNotesColumn(),
        spaceId: this.spaceId(),
        tenantName: tenant?.name ?? '',
        tenantLogoUrl: tenant?.logoUrl ?? null,
        filename: await this.exportFilename('png'),
      },
      this.injector
    );
  }

  private async exportXlsx(): Promise<void> {
    await this.xlsxService.exportDashboard(this.companies(), await this.exportFilename('xlsx'));
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

  toggleIntelligenceHeadlines(): void {
    const next = !this.showIntelligenceHeadlines();
    this.showIntelligenceHeadlines.set(next);
    try {
      localStorage.setItem(this.headlinePrefKey(), String(next));
    } catch {
      // Persistence is best-effort; the toggle still works for this session.
    }
  }

  private readHeadlinePref(): boolean | null {
    try {
      const stored = localStorage.getItem(this.headlinePrefKey());
      return stored === null ? null : stored === 'true';
    } catch {
      return null;
    }
  }

  onTrialClick(trial: Trial): void {
    // In the landscape timeline, a trial-row click opens the trial's owned
    // primary intelligence in the detail pane (rather than navigating away).
    void this.state.selectTrial(trial.id);
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
