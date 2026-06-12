import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../../../shared/components/clint-mark';
import { DashboardGridComponent } from '../grid/dashboard-grid.component';
import { LegendComponent } from '../legend/legend.component';

/**
 * Off-screen capture root for the PNG export. Stacks the real dashboard grid,
 * the real legend, and an app-styled footer; PngExportService rasterizes this
 * element via modern-screenshot so the export is the app's own rendering, not
 * a re-implementation. Never routed, never visible: the service creates it,
 * parks it off-viewport, captures, and destroys it.
 *
 * w-max matters: the host's width must come from the grid's full content
 * track, otherwise the grid's overflow-x-auto container clips to the viewport
 * and the capture loses everything past the fold.
 */
@Component({
  selector: 'app-export-snapshot-host',
  imports: [DashboardGridComponent, LegendComponent],
  host: { class: 'block w-max bg-white' },
  template: `
    <app-dashboard-grid
      [companies]="companies()"
      [zoomLevel]="zoomLevel()"
      [startYear]="startYear()"
      [endYear]="endYear()"
      [hideCompanyColumn]="hideCompanyColumn()"
      [hideAssetColumn]="hideAssetColumn()"
      [hideTrialColumn]="hideTrialColumn()"
      [hideMoaColumn]="hideMoaColumn()"
      [hideRoaColumn]="hideRoaColumn()"
      [hideNotesColumn]="hideNotesColumn()"
    />
    <app-legend [spaceId]="spaceId()" />
    <footer class="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2">
      <svg width="16" height="16" [attr.viewBox]="markViewBox" fill="none" aria-hidden="true">
        <polyline
          [attr.points]="mark.outer"
          stroke="#cbd5e1"
          [attr.stroke-width]="markStrokes.outer"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          [attr.points]="mark.middle"
          stroke="#94a3b8"
          [attr.stroke-width]="markStrokes.middle"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          [attr.points]="mark.inner"
          stroke="var(--brand-600)"
          [attr.stroke-width]="markStrokes.inner"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <!-- Artifact label, not the brand name: tenant-named hosts made the
           brand name duplicate the PREPARED FOR tenant segment. -->
      <span class="text-xs font-bold text-slate-600">Timeline</span>
      @if (agencyName(); as agency) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Delivered by
        </span>
        <!-- Logos arrive as pre-rasterized PNG data URIs from PngExportService
             (CORS-safe for the DOM capture); plain img because NgOptimizedImage
             rejects base64 sources. -->
        @if (agencyLogoUrl(); as alogo) {
          <!-- eslint-disable-next-line @angular-eslint/template/prefer-ngsrc -->
          <img [src]="alogo" alt="" class="h-4 w-auto max-w-[80px] object-contain" />
        } @else {
          <span class="text-[11px] font-semibold text-slate-600">{{ agency }}</span>
        }
      }
      @if (tenantName(); as tname) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Prepared for
        </span>
        @if (tenantLogoUrl(); as tlogo) {
          <!-- eslint-disable-next-line @angular-eslint/template/prefer-ngsrc -->
          <img [src]="tlogo" alt="" class="h-4 w-4 rounded object-contain" />
        }
        <span class="max-w-[160px] truncate text-[11px] font-semibold text-slate-600">
          {{ tname }}
        </span>
      }
      <span class="ml-auto text-[11px] text-slate-400">{{ exportDate }}</span>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportSnapshotHostComponent {
  private readonly brand = inject(BrandContextService);

  readonly companies = input.required<Company[]>();
  readonly zoomLevel = input.required<ZoomLevel>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly hideCompanyColumn = input(false);
  readonly hideAssetColumn = input(false);
  readonly hideTrialColumn = input(false);
  readonly hideMoaColumn = input(false);
  readonly hideRoaColumn = input(false);
  readonly hideNotesColumn = input(false);
  readonly spaceId = input.required<string>();
  readonly tenantName = input('');
  /** Pre-rasterized PNG data URIs (or null), supplied by PngExportService. */
  readonly tenantLogoUrl = input<string | null>(null);
  readonly agencyLogoUrl = input<string | null>(null);

  protected readonly agencyName = computed(() => this.brand.agency()?.name ?? null);

  protected readonly mark = CLINT_MARK_POINTS;
  protected readonly markViewBox = CLINT_MARK_VIEWBOX;
  protected readonly markStrokes = clintMarkStrokes(16);

  protected readonly exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
