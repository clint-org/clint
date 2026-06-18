import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import {
  ENTITY_TYPE_LABEL,
  IntelligenceFeedRow,
} from '../../../core/models/primary-intelligence.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { highlightHtml, highlightPlain } from '../../utils/highlight-search';
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';

/**
 * Recency-ordered feed of published primary intelligence reads. Used on the
 * engagement landing's "Latest from Stout" surface and on the browse view.
 *
 * Each row reads as a scannable analyst read: a thin entity-colored spine
 * (engagement = brand accent, every other entity = neutral slate so data
 * colors never decorate), the shared entity chip + tabular date on top, the
 * headline leading, a two-line summary clamp, then a quiet author byline with
 * a READ affordance. The whole row is a single click target via the title's
 * stretched ::before overlay.
 *
 * Strictly editorial: change events live in the "What changed" widget and
 * the Activity page. Mixing the two surfaces here in the past produced
 * duplicate rows visible to the same user.
 */
@Component({
  selector: 'app-intelligence-feed',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <ul class="bg-white">
      @for (row of rows(); track row.id) {
        <li class="group relative flex border-b border-slate-100 last:border-b-0">
          <span
            class="w-[3px] shrink-0"
            [class.bg-brand-500]="row.entity_type === 'space'"
            [class.bg-slate-300]="row.entity_type !== 'space'"
            aria-hidden="true"
          ></span>
          <div class="min-w-0 flex-1 px-[22px] py-[17px] transition-colors group-hover:bg-slate-50">
            <div class="mb-2 flex items-center gap-2.5">
              <span
                class="inline-flex items-center border border-slate-200 bg-white px-2 py-1 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.1em]"
                [class.text-brand-700]="row.entity_type === 'space'"
                [class.text-slate-500]="row.entity_type !== 'space'"
              >
                {{ entityLabel(row) }}
              </span>
              <span class="ml-auto font-mono text-[10px] font-semibold tabular-nums text-slate-400">
                {{ row.updated_at | date: 'mediumDate' }}
              </span>
            </div>
            <a
              [routerLink]="entityRouterLink(row)"
              class="block text-[17px] font-bold leading-snug text-slate-900 group-hover:text-brand-700 before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
              [innerHTML]="headline(row)"
            ></a>
            @if (excerpt(row); as e) {
              <p class="mt-[7px] text-[13.5px] leading-relaxed text-slate-600 line-clamp-2" [innerHTML]="e"></p>
            }
            <div class="mt-2.5 flex items-center gap-2">
              <span class="h-[18px] w-[18px] shrink-0 rounded-full bg-slate-200" aria-hidden="true"></span>
              <span class="font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">
                {{ agencyName() }}
              </span>
              <span
                class="relative ml-auto font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-brand-700"
                aria-hidden="true"
              >
                Read &rarr;
              </span>
            </div>
          </div>
        </li>
      } @empty {
        <li class="px-4 py-6 text-sm text-slate-400">No published reads yet.</li>
      }
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceFeedComponent {
  private readonly brand = inject(BrandContextService);

  readonly rows = input<IntelligenceFeedRow[]>([]);
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);
  /** Optional active search query -- when set, occurrences are wrapped in <mark>. */
  readonly query = input<string>('');

  protected readonly agencyName = computed(() => {
    const b = this.brand.brand();
    if (b.kind === 'tenant') return b.agency?.name ?? b.app_display_name;
    return b.app_display_name;
  });

  protected entityLabel(row: IntelligenceFeedRow): string {
    return ENTITY_TYPE_LABEL[row.entity_type] ?? row.entity_type;
  }

  protected entityRouterLink(row: IntelligenceFeedRow): unknown[] {
    return (
      buildEntityRouterLink(this.tenantId(), this.spaceId(), row.entity_type, row.entity_id) ?? []
    );
  }

  protected headline(row: IntelligenceFeedRow): string {
    return highlightPlain(row.headline ?? '', this.query());
  }

  protected excerpt(row: IntelligenceFeedRow): string {
    const html = renderMarkdownInline(row.summary_md ?? '');
    return highlightHtml(html, this.query());
  }
}
