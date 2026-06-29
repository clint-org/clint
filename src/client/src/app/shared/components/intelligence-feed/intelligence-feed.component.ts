import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ENTITY_TYPE_LABEL } from '../../../core/models/primary-intelligence.model';
import {
  type BriefFeedItem,
  type EventFeedItem,
  type FeedItem,
} from '../../../core/models/intelligence-feed-item.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { highlightHtml, highlightPlain } from '../../utils/highlight-search';
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';
import { MarkerIconComponent } from '../svg-icons/marker-icon.component';
import { eventFeedDateLabel } from './event-feed-date-label';

/**
 * Recency-ordered unified Intelligence feed: published intelligence briefs and
 * events interleaved. Each row renders by `kind`.
 *
 * A brief row reads as a scannable intelligence entry: a thin entity-colored
 * spine (engagement = brand accent, every other entity = neutral slate so data
 * colors never decorate), the entity chip + tabular date on top, the headline
 * leading, a two-line summary clamp, then a quiet author byline with an OPEN
 * affordance. The whole row is a single click target navigating to the entity.
 *
 * An event row shares the spine + density but leads with the marker glyph + a
 * category chip, the event title, and the (fuzzy/projected) event date; the
 * click target emits `eventOpen` so the host can open the event detail panel in
 * place. The feed is NOT significance-gated -- every event appears here, unlike
 * the timeline.
 *
 * The landing "Latest from Stout" surface passes only brief items, so its
 * appearance is unchanged.
 */
@Component({
  selector: 'app-intelligence-feed',
  standalone: true,
  imports: [RouterLink, DatePipe, MarkerIconComponent],
  template: `
    <ul class="bg-white">
      @for (row of rows(); track row.id) {
        <li class="group relative flex border-b border-slate-100 last:border-b-0">
          <span
            class="w-[3px] shrink-0"
            [class.bg-brand-500]="spineIsBrand(row)"
            [class.bg-slate-300]="!spineIsBrand(row)"
            aria-hidden="true"
          ></span>
          @if (row.kind === 'event') {
            @let ev = asEvent(row);
            <div class="min-w-0 flex-1 px-4 py-2 transition-colors group-hover:bg-slate-50">
              <div class="flex items-center gap-2">
                <app-marker-icon
                  [shape]="ev.marker_shape"
                  [color]="ev.marker_color"
                  [size]="12"
                  [fillStyle]="ev.is_projected ? 'outline' : 'filled'"
                  [innerMark]="ev.marker_inner_mark"
                  [isNle]="ev.no_longer_expected"
                />
                <span
                  class="shrink-0 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.1em] text-slate-400"
                >
                  {{ ev.category_name }}
                </span>
                <button
                  type="button"
                  data-event-open
                  class="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold leading-tight text-slate-900 group-hover:text-brand-700 before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
                  (click)="eventOpen.emit(ev.id)"
                  [innerHTML]="eventTitle(ev)"
                ></button>
                <span
                  class="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-slate-400"
                  [class.italic]="ev.is_projected"
                >
                  {{ eventDateLabel(ev) }}
                </span>
              </div>
              <div class="mt-0.5 flex items-baseline gap-1.5 pl-[20px] text-[11.5px] leading-tight">
                <span class="shrink-0 font-mono text-[10px] uppercase tracking-[0.04em] text-slate-400">
                  {{ ev.entity_name ?? 'Engagement' }}
                </span>
                @if (ev.description; as d) {
                  <span class="min-w-0 flex-1 truncate text-slate-500">{{ d }}</span>
                }
              </div>
            </div>
          } @else {
            @let br = asBrief(row);
            <div class="min-w-0 flex-1 px-4 py-2 transition-colors group-hover:bg-slate-50">
              <div class="flex items-center gap-2">
                <span
                  class="shrink-0 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.1em]"
                  [class.text-brand-700]="br.entity_type === 'space'"
                  [class.text-slate-400]="br.entity_type !== 'space'"
                >
                  {{ entityLabel(br) }}
                </span>
                <a
                  [routerLink]="entityRouterLink(br)"
                  class="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-tight text-slate-900 group-hover:text-brand-700 before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
                  [innerHTML]="headline(br)"
                ></a>
                <span class="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-slate-400">
                  {{ br.feed_ts | date: 'mediumDate' }}
                </span>
              </div>
              @if (excerpt(br); as e) {
                <p
                  class="mt-0.5 truncate pl-[20px] text-[11.5px] leading-tight text-slate-500"
                  [innerHTML]="e"
                ></p>
              }
            </div>
          }
        </li>
      } @empty {
        <li class="px-4 py-6 text-sm text-slate-400">No intelligence or events yet.</li>
      }
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceFeedComponent {
  private readonly brand = inject(BrandContextService);

  readonly rows = input<FeedItem[]>([]);
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);
  /** Optional active search query -- when set, occurrences are wrapped in <mark>. */
  readonly query = input<string>('');

  /** Emits the event id when an event row is activated, so the host can open
   *  the event detail panel in place. */
  readonly eventOpen = output<string>();

  protected readonly agencyName = computed(() => {
    const b = this.brand.brand();
    if (b.kind === 'tenant') return b.agency?.name ?? b.app_display_name;
    return b.app_display_name;
  });

  protected spineIsBrand(row: FeedItem): boolean {
    return row.kind === 'brief' && row.entity_type === 'space';
  }

  protected asBrief(row: FeedItem): BriefFeedItem {
    return row as BriefFeedItem;
  }

  protected asEvent(row: FeedItem): EventFeedItem {
    return row as EventFeedItem;
  }

  protected entityLabel(row: BriefFeedItem): string {
    return ENTITY_TYPE_LABEL[row.entity_type] ?? row.entity_type;
  }

  protected entityRouterLink(row: BriefFeedItem): unknown[] {
    return (
      buildEntityRouterLink(this.tenantId(), this.spaceId(), row.entity_type, row.entity_id) ?? []
    );
  }

  protected headline(row: BriefFeedItem): string {
    return highlightPlain(row.title ?? '', this.query());
  }

  protected excerpt(row: BriefFeedItem): string {
    const html = renderMarkdownInline(row.summary_md ?? '');
    return highlightHtml(html, this.query());
  }

  protected eventTitle(row: EventFeedItem): string {
    return highlightPlain(row.title ?? '', this.query());
  }

  protected eventExcerpt(row: EventFeedItem): string {
    if (!row.description) return '';
    return highlightPlain(row.description, this.query());
  }

  protected eventDateLabel(row: EventFeedItem): string {
    return eventFeedDateLabel(row);
  }
}
