import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { BullseyeData } from '../../core/models/landscape.model';
import { ExportFooterComponent } from '../../shared/export/export-footer.component';
import { BullseyeChartComponent } from './bullseye-chart.component';

/**
 * Off-screen capture root for the bullseye PNG export: title + the real chart +
 * branded footer. Never routed; BrandedPngExportService creates it, parks it
 * off-viewport, rasterizes, and destroys it.
 *
 * The chart sits in .bullseye-export-frame (landscape.css), a definite
 * 960px square: the chart's live sizing rules are container-query-driven and
 * collapse to the SVG's intrinsic fallback inside this host's max-content
 * sizing, which exported a tiny, soft PNG. The host (w-max) shrink-wraps the
 * header and footer to the frame width.
 *
 * The chart is bound as a static snapshot. Of its inputs only `data` is
 * required; every interaction input (selectedAssetId, hoveredAssetId,
 * highlightedRing, matchedAssetIds) is optional and left at its
 * "nothing selected" default, so we omit them here. `duplicatedAssetIds` is
 * the one non-interaction input we forward: the page computes which assets
 * appear in multiple spokes and the chart draws dashed outlines for them, so
 * passing the real set keeps the export visually identical to the live view.
 * It stays optional (empty-Set default) so callers that lack it still render.
 */
@Component({
  selector: 'app-bullseye-export-host',
  imports: [BullseyeChartComponent, ExportFooterComponent],
  host: { class: 'block w-max bg-white' },
  template: `
    <header class="px-6 pt-5 pb-2">
      <h2 class="text-sm font-bold tracking-tight text-slate-800">{{ title() }}</h2>
    </header>
    <div class="px-6 pb-4">
      <div class="bullseye-export-frame">
        <app-bullseye-chart [data]="data()" [duplicatedAssetIds]="duplicatedAssetIds()" />
      </div>
    </div>
    <app-export-footer
      artifactLabel="Bullseye"
      [tenantName]="tenantName()"
      [tenantLogoUrl]="tenantLogoUrl()"
      [agencyLogoUrl]="agencyLogoUrl()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BullseyeExportHostComponent {
  readonly title = input.required<string>();
  readonly data = input.required<BullseyeData>();
  /** Real duplicated-asset set from the page so dashed outlines match the live view. */
  readonly duplicatedAssetIds = input(new Set<string>());
  readonly tenantName = input('');
  /** Pre-rasterized PNG data URIs (or null), supplied by BrandedPngExportService. */
  readonly tenantLogoUrl = input<string | null>(null);
  readonly agencyLogoUrl = input<string | null>(null);
}
