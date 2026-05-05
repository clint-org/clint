import { Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { EventDetail, FeedItem } from '../../core/models/event.model';
import { MarkerDetailContentComponent } from '../../shared/components/marker-detail-content.component';
import { DetailPanelEmptyStateComponent } from '../../shared/components/detail-panel-empty-state.component';
import { DetailPanelEntityListComponent } from '../../shared/components/detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from '../../shared/components/detail-panel-entity-row.component';
import { DetailPanelPillComponent } from '../../shared/components/detail-panel-pill.component';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';

interface CategoryHistogramEntry {
  name: string;
  count: number;
  color: string;
}

interface RecentItemSummary {
  id: string;
  title: string;
  event_date: string;
}

const CATEGORY_COLOR_FALLBACK = '#94a3b8';

const CATEGORY_COLOR: Record<string, string> = {
  'M&A': '#f97316', // orange-500
  Earnings: '#0891b2', // cyan-600
  Conference: '#8b5cf6', // violet-500
  Licensing: '#f59e0b', // amber-500
  Regulatory: '#dc2626', // red-600
  Clinical: '#16a34a', // green-600
};

@Component({
  selector: 'app-event-detail-panel',
  standalone: true,
  imports: [
    DatePipe,
    DetailPanelEmptyStateComponent,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelPillComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    MarkerDetailContentComponent,
  ],
  template: `
    <app-detail-panel-shell
      [label]="headerLabel()"
      [labelTone]="hasSelection() ? 'brand' : 'muted'"
      [showClose]="hasSelection()"
      (closed)="panelClose.emit()"
    >
      @if (hasSelection() && canEdit()) {
        <button
          headerActions
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
          (click)="edit.emit()"
          aria-label="Edit event"
        >
          <i class="fa-solid fa-pen text-xs"></i>
        </button>
      }

      @if (detail(); as d) {
        <h2 class="text-base font-semibold leading-snug text-slate-900">{{ d.title }}</h2>

        <div class="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          <span class="font-mono tabular-nums">{{ d.event_date | date: 'mediumDate' }}</span>
          @if (d.priority === 'high') {
            <app-detail-panel-pill tone="red">High priority</app-detail-panel-pill>
          }
          @if (d.entity_level === 'space') {
            <span class="text-slate-400">Industry</span>
          } @else if (d.company_name) {
            <span class="text-slate-400">
              {{ d.company_name }}
              @if (d.entity_level !== 'company' && d.entity_name) {
                <span class="text-slate-300"> / </span>{{ d.entity_name }}
              }
            </span>
          }
        </div>

        @if (d.description) {
          <app-detail-panel-section [first]="true" label="Description">
            <p class="text-[13px] leading-relaxed text-slate-700">{{ d.description }}</p>
          </app-detail-panel-section>
        }

        @if (d.sources.length > 0) {
          <app-detail-panel-section [first]="!d.description" label="Sources">
            <ul class="space-y-1">
              @for (src of d.sources; track src.id) {
                <li>
                  <a
                    [href]="src.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-[12px] text-brand-700 hover:text-brand-800 hover:underline"
                  >
                    {{ src.label || src.url }}
                    <i
                      class="fa-solid fa-arrow-up-right-from-square text-[9px]"
                      aria-hidden="true"
                    ></i>
                  </a>
                </li>
              }
            </ul>
          </app-detail-panel-section>
        }

        @if (d.tags.length > 0) {
          <app-detail-panel-section label="Tags">
            <div class="flex flex-wrap gap-1">
              @for (tag of d.tags; track tag) {
                <span class="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{{
                  tag
                }}</span>
              }
            </div>
          </app-detail-panel-section>
        }

        @if (d.thread; as thread) {
          <app-detail-panel-section [label]="'Thread · ' + thread.title">
            <ol class="space-y-px border-l border-slate-200 pl-3">
              @for (te of thread.events; track te.id) {
                <li>
                  @if (te.id === d.id) {
                    <div
                      class="flex items-center justify-between gap-2 rounded-sm bg-brand-50 px-2 py-1"
                    >
                      <span class="flex min-w-0 items-center gap-2 text-[11px] leading-snug">
                        <span class="font-mono tabular-nums text-brand-700">{{
                          te.event_date | date: 'mediumDate'
                        }}</span>
                        <span class="truncate font-semibold text-brand-800">{{ te.title }}</span>
                      </span>
                      <span class="text-[9px] font-semibold uppercase tracking-wider text-brand-600"
                        >current</span
                      >
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="group flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      (click)="threadEventClick.emit(te.id)"
                    >
                      <span class="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{{
                        te.event_date | date: 'mediumDate'
                      }}</span>
                      <span class="min-w-0 flex-1 truncate text-[11px] text-slate-600">{{
                        te.title
                      }}</span>
                      <i
                        class="fa-solid fa-arrow-right text-[10px] text-slate-300 group-hover:text-brand-600"
                        aria-hidden="true"
                      ></i>
                    </button>
                  }
                </li>
              }
            </ol>
          </app-detail-panel-section>
        }

        @if (d.linked_events.length > 0) {
          <app-detail-panel-section label="Related events">
            <app-detail-panel-entity-list>
              @for (le of d.linked_events; track le.id) {
                <app-detail-panel-entity-row (rowClick)="relatedEventClick.emit(le.id)">
                  <span class="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{{
                    le.event_date | date: 'mediumDate'
                  }}</span>
                  <span class="min-w-0 flex-1 truncate text-[12px] text-slate-700">{{
                    le.title
                  }}</span>
                  <span class="shrink-0 text-[10px] text-slate-400">({{ le.category_name }})</span>
                </app-detail-panel-entity-row>
              }
            </app-detail-panel-entity-list>
          </app-detail-panel-section>
        }

        <p class="mt-4 text-[10px] text-slate-400">Created {{ d.created_at | date: 'medium' }}</p>
      } @else if (catalystDetail()) {
        <app-marker-detail-content
          [detail]="catalystDetail()"
          (markerClick)="markerSelect.emit($event)"
          (eventClick)="relatedEventClick.emit($event)"
          (trialClick)="trialClick.emit($event)"
        />
      } @else {
        <app-detail-panel-empty-state prompt="Click an event to see details">
          <p class="mt-2 text-[13px] text-slate-700">
            <span class="text-base font-semibold tabular-nums text-slate-900">{{
              feedItems().length
            }}</span>
            in window
            @if (highPriorityCount() > 0) {
              <span class="text-slate-500"
                >&middot;
                <span class="font-medium text-slate-900">{{ highPriorityCount() }}</span> high
                priority</span
              >
            }
          </p>

          @if (categoryHistogram().length > 0) {
            <app-detail-panel-section [first]="true" label="By category">
              <app-detail-panel-entity-list>
                @for (entry of categoryHistogram(); track entry.name) {
                  <app-detail-panel-entity-row (rowClick)="categoryFilter.emit(entry.name)">
                    <span
                      class="inline-block h-2 w-2 shrink-0 rounded-full"
                      [style.background-color]="entry.color"
                      aria-hidden="true"
                    ></span>
                    <span class="min-w-0 flex-1 truncate text-[12px] text-slate-700">{{
                      entry.name
                    }}</span>
                    <span class="shrink-0 font-mono text-[12px] tabular-nums text-slate-900">{{
                      entry.count
                    }}</span>
                  </app-detail-panel-entity-row>
                }
              </app-detail-panel-entity-list>
            </app-detail-panel-section>
          }

          @if (mostRecent().length > 0) {
            <app-detail-panel-section label="Most recent">
              <app-detail-panel-entity-list>
                @for (item of mostRecent(); track item.id) {
                  <app-detail-panel-entity-row (rowClick)="recentClick.emit(item.id)">
                    <span class="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{{
                      item.event_date | date: 'MMM d'
                    }}</span>
                    <span class="min-w-0 flex-1 truncate text-[12px] text-slate-700">{{
                      item.title
                    }}</span>
                  </app-detail-panel-entity-row>
                }
              </app-detail-panel-entity-list>
            </app-detail-panel-section>
          }
        </app-detail-panel-empty-state>
      }

      @if (detail()?.thread) {
        <div footer class="border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            class="inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-brand-600 hover:text-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
            (click)="openThread.emit()"
          >
            Open thread
            <i class="fa-solid fa-arrow-right text-[10px]" aria-hidden="true"></i>
          </button>
        </div>
      }
    </app-detail-panel-shell>
  `,
})
export class EventDetailPanelComponent {
  readonly detail = input<EventDetail | null>(null);
  readonly catalystDetail = input<CatalystDetail | null>(null);
  readonly canEdit = input<boolean>(true);

  /** Feed snapshot used to render the empty-state overview. */
  readonly feedItems = input<FeedItem[]>([]);

  readonly edit = output<void>();
  readonly panelClose = output<void>();
  readonly openThread = output<void>();
  readonly threadEventClick = output<string>();
  readonly relatedEventClick = output<string>();
  readonly recentClick = output<string>();
  readonly categoryFilter = output<string>();
  readonly markerSelect = output<string>();
  readonly trialClick = output<string>();

  readonly hasSelection = computed(() => !!this.detail() || !!this.catalystDetail());

  readonly headerLabel = computed(() => {
    const d = this.detail();
    if (d) return d.category.name;
    const cd = this.catalystDetail();
    if (cd) return `${cd.catalyst.category_name} · ${cd.catalyst.marker_type_name}`;
    return 'Events · overview';
  });

  readonly highPriorityCount = computed(
    () => this.feedItems().filter((i) => i.priority === 'high').length
  );

  readonly categoryHistogram = computed<CategoryHistogramEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const item of this.feedItems()) {
      counts.set(item.category_name, (counts.get(item.category_name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({
        name,
        count,
        color: CATEGORY_COLOR[name] ?? CATEGORY_COLOR_FALLBACK,
      }))
      .sort((a, b) => b.count - a.count);
  });

  readonly mostRecent = computed<RecentItemSummary[]>(() =>
    this.feedItems()
      .slice()
      .sort((a, b) => b.event_date.localeCompare(a.event_date))
      .slice(0, 3)
      .map((i) => ({ id: i.id, title: i.title, event_date: i.event_date }))
  );
}
