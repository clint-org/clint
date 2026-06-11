import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
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
  imports: [BrandLogoComponent, DashboardGridComponent, LegendComponent],
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
      @if (logoUrl(); as logo) {
        <app-brand-logo
          [url]="logo"
          alt=""
          [width]="16"
          [height]="16"
          imgClass="h-4 w-4 rounded object-contain"
        />
      }
      <span class="text-xs font-bold text-slate-600">{{ appDisplayName() }}</span>
      @if (agencyName(); as agency) {
        <span class="text-[11px] italic text-slate-400">
          Intelligence delivered by {{ agency }}
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

  protected readonly appDisplayName = computed(() => this.brand.appDisplayName());
  protected readonly logoUrl = computed(() => this.brand.logoUrl());
  protected readonly agencyName = computed(() => this.brand.agency()?.name ?? null);

  protected readonly exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
