import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { CountUnit, HeatmapBubble } from '../../core/models/landscape.model';
import { ExportFooterComponent } from '../../shared/export/export-footer.component';
import { HeatmapComponent, type SortField } from './heatmap.component';

/**
 * Off-screen capture root for the heatmap PNG export: title + the real heatmap
 * matrix (no detail panel, no interaction) + branded footer. Never routed;
 * BrandedPngExportService creates it, parks it off-viewport, rasterizes, and
 * destroys it.
 *
 * w-max matters: the host sizes to the matrix's natural width so the capture
 * isn't clipped.
 *
 * The matrix is a static snapshot. `selectedBubble` is pinned to null (no row
 * highlight) and the `(rowClick)` / `(sortChange)` outputs are never wired.
 * Every other input mirrors the live view (heatmap-view.component.ts) so the
 * export reads identically: count unit, sort field/direction, freshness date,
 * and the preclinical-column toggle.
 */
@Component({
  selector: 'app-heatmap-export-host',
  imports: [HeatmapComponent, ExportFooterComponent],
  host: { class: 'block w-max bg-white' },
  template: `
    <header class="px-6 pt-5 pb-2">
      <h2 class="text-sm font-bold tracking-tight text-slate-800">{{ title() }}</h2>
    </header>
    <div class="px-6 pb-4">
      <app-heatmap
        [bubbles]="bubbles()"
        [countUnit]="countUnit()"
        [selectedBubble]="null"
        [sortField]="sortField()"
        [sortDir]="sortDir()"
        [latestEventDate]="latestEventDate()"
        [showPreclinical]="showPreclinical()"
      />
    </div>
    <app-export-footer
      artifactLabel="Heatmap"
      [tenantName]="tenantName()"
      [tenantLogoUrl]="tenantLogoUrl()"
      [agencyLogoUrl]="agencyLogoUrl()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapExportHostComponent {
  readonly title = input.required<string>();
  readonly bubbles = input.required<HeatmapBubble[]>();
  readonly countUnit = input.required<CountUnit>();
  readonly sortField = input.required<SortField>();
  readonly sortDir = input.required<'asc' | 'desc'>();
  readonly latestEventDate = input<string | null>(null);
  readonly showPreclinical = input(false);
  readonly tenantName = input('');
  /** Pre-rasterized PNG data URIs (or null), supplied by BrandedPngExportService. */
  readonly tenantLogoUrl = input<string | null>(null);
  readonly agencyLogoUrl = input<string | null>(null);
}
