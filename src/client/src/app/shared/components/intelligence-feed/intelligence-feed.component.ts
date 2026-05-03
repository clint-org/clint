import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import type { ChangeEvent } from '../../../core/models/change-event.model';
import {
  ENTITY_TYPE_LABEL,
  IntelligenceFeedRow,
} from '../../../core/models/primary-intelligence.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { highlightHtml, highlightPlain } from '../../utils/highlight-search';
import { summaryFor } from '../../utils/change-event-summary';

/**
 * Discriminated row type for the intelligence feed. Lets the engagement
 * landing interleave Stout-authored intelligence with high-signal
 * CT.gov-source change events without losing per-row visual identity.
 */
export type IntelligenceFeedItem =
  | { kind: 'intelligence'; intelligence: IntelligenceFeedRow }
  | { kind: 'system_update'; event: ChangeEvent };

/**
 * Recency-ordered feed of published primary intelligence reads, optionally
 * mixed with system update rows (CT.gov-source change events). Used on the
 * engagement landing's "Latest from Stout" surface and (with more rows) on
 * the browse view.
 *
 * Two input shapes are supported:
 * - `rows`: legacy `IntelligenceFeedRow[]` (browse view, intelligence-only).
 * - `items`: discriminated `IntelligenceFeedItem[]` (landing, mixed feed).
 *
 * If `items` is non-null it takes precedence; otherwise `rows` is wrapped
 * into intelligence-kind items for rendering.
 */
@Component({
  selector: 'app-intelligence-feed',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <ul class="divide-y divide-slate-100 border border-slate-200 bg-white">
      @for (item of mergedItems(); track itemKey(item)) {
        @switch (item.kind) {
          @case ('intelligence') {
            <li class="group relative px-4 py-3 transition-colors hover:bg-slate-50">
              <div class="mb-1 flex flex-wrap items-baseline gap-2">
                <span
                  class="rounded-sm border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500"
                >
                  {{ entityLabel(item.intelligence) }}
                </span>
                <a
                  [routerLink]="entityRouterLink(item.intelligence)"
                  class="text-sm font-semibold text-slate-900 group-hover:text-brand-700 before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
                  [innerHTML]="headline(item.intelligence)"
                ></a>
                <span class="ml-auto font-mono text-[10px] text-slate-400 tabular-nums">
                  {{ item.intelligence.updated_at | date: 'mediumDate' }}
                </span>
              </div>
              @if (excerpt(item.intelligence); as e) {
                <p class="mb-1 text-sm text-slate-600 line-clamp-2" [innerHTML]="e"></p>
              }
              <p class="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                By {{ agencyName() }}
              </p>
            </li>
          }
          @case ('system_update') {
            <li
              class="border-l-2 border-slate-300 px-4 py-2.5 hover:bg-slate-50"
              aria-label="System update"
            >
              <div class="mb-0.5 flex flex-wrap items-baseline gap-2">
                <span class="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  System update
                </span>
                <span class="text-xs text-slate-500">
                  {{ item.event.trial_identifier ?? item.event.trial_name }}
                </span>
                <span class="ml-auto font-mono text-[10px] text-slate-400 tabular-nums">
                  {{ item.event.observed_at | date: 'mediumDate' }}
                </span>
              </div>
              <p class="text-xs text-slate-700">{{ summaryLine(item.event) }}</p>
            </li>
          }
        }
      } @empty {
        <li class="px-4 py-6 text-sm text-slate-400">No published reads yet.</li>
      }
    </ul>
  `,
})
export class IntelligenceFeedComponent {
  private readonly brand = inject(BrandContextService);

  readonly rows = input<IntelligenceFeedRow[]>([]);
  readonly items = input<IntelligenceFeedItem[] | null>(null);
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);
  /** Optional active search query -- when set, occurrences are wrapped in <mark>. */
  readonly query = input<string>('');

  protected readonly mergedItems = computed<IntelligenceFeedItem[]>(() => {
    const explicit = this.items();
    if (explicit !== null) return explicit;
    return this.rows().map(
      (intelligence) => ({ kind: 'intelligence', intelligence }) as IntelligenceFeedItem
    );
  });

  protected readonly agencyName = computed(() => {
    const b = this.brand.brand();
    if (b.kind === 'tenant') return b.agency?.name ?? b.app_display_name;
    return b.app_display_name;
  });

  protected itemKey(item: IntelligenceFeedItem): string {
    return item.kind === 'intelligence' ? `i:${item.intelligence.id}` : `s:${item.event.id}`;
  }

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

  protected summaryLine(e: ChangeEvent): string {
    return summaryFor(e);
  }
}
