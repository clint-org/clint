import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  ENTITY_TYPE_LABEL,
  IntelligenceFeedRow,
} from '../../../core/models/primary-intelligence.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { highlightHtml, highlightPlain } from '../../utils/highlight-search';

/**
 * Recency-ordered feed of published primary intelligence reads. Used on
 * the engagement landing's "Latest from Stout" surface and (with more
 * rows) on the browse view.
 */
@Component({
  selector: 'app-intelligence-feed',
  standalone: true,
  imports: [RouterLink],
  template: `
    <ul class="divide-y divide-slate-100 border border-slate-200 bg-white">
      @for (row of rows(); track row.id) {
        <li class="group relative px-4 py-3 transition-colors hover:bg-slate-50">
          <div class="mb-1 flex flex-wrap items-baseline gap-2">
            <span
              class="rounded-sm border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500"
            >
              {{ entityLabel(row) }}
            </span>
            <a
              [routerLink]="entityRouterLink(row)"
              class="text-sm font-semibold text-slate-900 group-hover:text-brand-700 before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
              [innerHTML]="headline(row)"
            ></a>
            <span class="ml-auto font-mono text-[10px] text-slate-400 tabular-nums">
              {{ formatDate(row.updated_at) }}
            </span>
          </div>
          @if (excerpt(row); as e) {
            <p class="mb-1 text-sm text-slate-600 line-clamp-2" [innerHTML]="e"></p>
          }
          <p class="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            By {{ agencyName() }}
          </p>
        </li>
      } @empty {
        <li class="px-4 py-6 text-sm text-slate-400">No published reads yet.</li>
      }
    </ul>
  `,
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
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return [];
    if (row.entity_type === 'trial') {
      return ['/t', t, 's', s, 'manage', 'trials', row.entity_id];
    }
    return ['/t', t, 's', s, 'intelligence'];
  }

  protected headline(row: IntelligenceFeedRow): string {
    return highlightPlain(row.headline ?? '', this.query());
  }

  protected excerpt(row: IntelligenceFeedRow): string {
    const html = renderMarkdownInline(row.thesis_md ?? '');
    return highlightHtml(html, this.query());
  }

  protected formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
