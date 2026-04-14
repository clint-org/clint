import { Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { EventDetail, FeedItem } from '../../core/models/event.model';

@Component({
  selector: 'app-event-detail-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="event-detail-panel flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white">
      <!-- Panel header -->
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {{ categoryLabel() }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          @if (detail()) {
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
              (click)="edit.emit()"
              aria-label="Edit event"
            >
              <i class="fa-solid fa-pen text-xs"></i>
            </button>
          }
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
            (click)="panelClose.emit()"
            aria-label="Close detail panel"
          >
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
      </div>

      <!-- Panel body (scrollable) -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        @if (detail(); as d) {
          <!-- Event detail -->
          <h2 class="mb-3 text-sm font-semibold leading-snug text-slate-900">{{ d.title }}</h2>

          <!-- Meta row -->
          <div class="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{{ d.event_date | date:'mediumDate' }}</span>
            @if (d.priority === 'high') {
              <span class="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                High priority
              </span>
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

          <!-- Description -->
          @if (d.description) {
            <div class="mb-4">
              <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Description</p>
              <p class="text-xs leading-relaxed text-slate-600">{{ d.description }}</p>
            </div>
          }

          <!-- Sources -->
          @if (d.sources.length > 0) {
            <div class="mb-4">
              <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Sources</p>
              <ul class="space-y-1">
                @for (src of d.sources; track src.id) {
                  <li>
                    <a
                      [href]="src.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 hover:underline"
                    >
                      {{ src.label || src.url }}
                      <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                    </a>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Tags -->
          @if (d.tags.length > 0) {
            <div class="mb-4">
              <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Tags</p>
              <div class="flex flex-wrap gap-1">
                @for (tag of d.tags; track tag) {
                  <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{{ tag }}</span>
                }
              </div>
            </div>
          }

          <!-- Thread -->
          @if (d.thread) {
            <div class="mb-4">
              <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Thread: {{ d.thread.title }}
              </p>
              <ol class="space-y-1.5 border-l-2 border-slate-200 pl-3">
                @for (te of d.thread.events; track te.id) {
                  <li
                    class="text-[11px] leading-snug"
                    [class.font-semibold]="te.id === d.id"
                    [class.text-teal-700]="te.id === d.id"
                    [class.text-slate-500]="te.id !== d.id"
                  >
                    {{ te.event_date | date:'mediumDate' }} &mdash; {{ te.title }}
                  </li>
                }
              </ol>
            </div>
          }

          <!-- Related events -->
          @if (d.linked_events.length > 0) {
            <div class="mb-4">
              <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Related events</p>
              <ul class="space-y-1">
                @for (le of d.linked_events; track le.id) {
                  <li class="text-[11px] text-slate-500">
                    {{ le.event_date | date:'mediumDate' }} &mdash; {{ le.title }}
                    <span class="text-slate-300">({{ le.category_name }})</span>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Created timestamp -->
          <p class="mt-2 text-[10px] text-slate-300">
            Created {{ d.created_at | date:'medium' }}
          </p>

        } @else {
          @if (marker(); as m) {
            <!-- Marker detail (simpler) -->
            <h2 class="mb-3 text-sm font-semibold leading-snug text-slate-900">{{ m.title }}</h2>

            <!-- Meta row -->
            <div class="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{{ m.event_date | date:'mediumDate' }}</span>
              @if (m.entity_level === 'space') {
                <span class="text-slate-400">Industry</span>
              } @else if (m.company_name) {
                <span class="text-slate-400">
                  {{ m.company_name }}
                  @if (m.entity_level !== 'company' && m.entity_name) {
                    <span class="text-slate-300"> / </span>{{ m.entity_name }}
                  }
                </span>
              }
            </div>

            <!-- Description -->
            @if (m.description) {
              <div class="mb-4">
                <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Description</p>
                <p class="text-xs leading-relaxed text-slate-600">{{ m.description }}</p>
              </div>
            }

            <!-- Source URL -->
            @if (m.source_url) {
              <div class="mb-4">
                <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Source</p>
                <a
                  [href]="m.source_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 hover:underline"
                >
                  {{ m.source_url }}
                  <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                </a>
              </div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class EventDetailPanelComponent {
  /** Full event detail -- set when a row of source_type 'event' is selected. */
  readonly detail = input<EventDetail | null>(null);
  /** Marker feed item -- set when a row of source_type 'marker' is selected. */
  readonly marker = input<FeedItem | null>(null);

  readonly edit = output<void>();
  readonly panelClose = output<void>();

  readonly categoryLabel = computed(() => {
    const d = this.detail();
    if (d) return d.category.name;
    const m = this.marker();
    if (m) return m.category_name;
    return '';
  });
}
