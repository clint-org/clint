import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { BrandContextService } from '../../core/services/brand-context.service';
import {
  CLINT_MARK_POINTS,
  CLINT_MARK_VIEWBOX,
  clintMarkStrokes,
} from '../components/clint-mark';

/**
 * Branded export footer shared by every export host (timeline, bullseye,
 * heatmap). Product mark + DELIVERED BY (agency) + PREPARED FOR (tenant) +
 * date. Logos arrive as pre-rasterized PNG data URIs (CORS-safe for capture);
 * plain <img> because NgOptimizedImage rejects base64 sources.
 */
@Component({
  selector: 'app-export-footer',
  host: { class: 'block' },
  template: `
    <footer class="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2">
      <svg width="16" height="16" [attr.viewBox]="markViewBox" fill="none" aria-hidden="true">
        <polyline [attr.points]="mark.outer" stroke="#cbd5e1" [attr.stroke-width]="markStrokes.outer" stroke-linecap="round" stroke-linejoin="round" />
        <polyline [attr.points]="mark.middle" stroke="#94a3b8" [attr.stroke-width]="markStrokes.middle" stroke-linecap="round" stroke-linejoin="round" />
        <polyline [attr.points]="mark.inner" stroke="#0d9488" [attr.stroke-width]="markStrokes.inner" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="text-xs font-bold text-slate-600">{{ artifactLabel() }}</span>
      @if (agencyName(); as agency) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">Delivered by</span>
        @if (agencyLogoUrl(); as alogo) {
          <!-- eslint-disable-next-line @angular-eslint/template/prefer-ngsrc -->
          <img [src]="alogo" alt="" class="h-4 w-auto max-w-[80px] object-contain" />
        } @else {
          <span class="text-[11px] font-semibold text-slate-600">{{ agency }}</span>
        }
      }
      @if (tenantName(); as tname) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">Prepared for</span>
        @if (tenantLogoUrl(); as tlogo) {
          <!-- eslint-disable-next-line @angular-eslint/template/prefer-ngsrc -->
          <img [src]="tlogo" alt="" class="h-4 w-4 rounded object-contain" />
        }
        <span class="max-w-[160px] truncate text-[11px] font-semibold text-slate-600">{{ tname }}</span>
      }
      <span class="ml-auto text-[11px] text-slate-400">{{ exportDate }}</span>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportFooterComponent {
  private readonly brand = inject(BrandContextService);

  readonly artifactLabel = input.required<string>();
  readonly tenantName = input('');
  /** Pre-rasterized PNG data URIs (or null), supplied by the caller. */
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
