import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { ExportFooterComponent } from '../../../shared/export/export-footer.component';
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
  imports: [DashboardGridComponent, LegendComponent, ExportFooterComponent],
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
      [hideIndicationColumn]="hideIndicationColumn()"
    />
    <app-legend [spaceId]="spaceId()" />
    <app-export-footer
      artifactLabel="Timeline"
      [tenantName]="tenantName()"
      [tenantLogoUrl]="tenantLogoUrl()"
      [agencyLogoUrl]="agencyLogoUrl()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportSnapshotHostComponent {
  readonly companies = input.required<Company[]>();
  readonly zoomLevel = input.required<ZoomLevel>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly hideCompanyColumn = input(false);
  readonly hideAssetColumn = input(false);
  readonly hideTrialColumn = input(false);
  readonly hideMoaColumn = input(false);
  readonly hideRoaColumn = input(false);
  readonly hideIndicationColumn = input(false);
  readonly spaceId = input.required<string>();
  readonly tenantName = input('');
  /** Pre-rasterized PNG data URIs (or null), supplied by PngExportService. */
  readonly tenantLogoUrl = input<string | null>(null);
  readonly agencyLogoUrl = input<string | null>(null);
}
