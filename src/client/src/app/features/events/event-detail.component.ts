import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { EventDetail } from '../../core/models/event.model';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [DatePipe],
  template: `
    @if (detail(); as d) {
      <div class="space-y-3 text-sm">
        <!-- Description -->
        @if (d.description) {
          <p class="text-slate-600">{{ d.description }}</p>
        }

        <!-- Sources -->
        @if (d.sources.length > 0) {
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Sources</p>
            <ul class="space-y-0.5">
              @for (src of d.sources; track src.id) {
                <li>
                  <a
                    [href]="src.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-teal-700 hover:text-teal-800 hover:underline"
                  >
                    {{ src.label || src.url }}
                    <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>
                  </a>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Thread -->
        @if (d.thread) {
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">
              Thread: {{ d.thread.title }}
            </p>
            <ol class="space-y-1 border-l-2 border-slate-200 pl-3">
              @for (te of d.thread.events; track te.id) {
                <li
                  class="text-xs"
                  [class.font-semibold]="te.id === d.id"
                  [class.text-teal-700]="te.id === d.id"
                  [class.text-slate-500]="te.id !== d.id"
                >
                  {{ te.event_date | date:'mediumDate' }} -- {{ te.title }}
                </li>
              }
            </ol>
          </div>
        }

        <!-- Linked events -->
        @if (d.linked_events.length > 0) {
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Related events</p>
            <ul class="space-y-0.5">
              @for (le of d.linked_events; track le.id) {
                <li class="text-xs text-slate-500">
                  {{ le.event_date | date:'mediumDate' }} -- {{ le.title }}
                  <span class="text-slate-300">({{ le.category_name }})</span>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Meta -->
        <p class="text-[10px] text-slate-300">
          Created {{ d.created_at | date:'medium' }}
        </p>
      </div>
    }
  `,
})
export class EventDetailComponent {
  readonly detail = input.required<EventDetail>();
}
