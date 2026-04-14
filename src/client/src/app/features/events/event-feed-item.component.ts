import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { Tag } from 'primeng/tag';

import { EventDetail, FeedItem } from '../../core/models/event.model';
import { EventDetailComponent } from './event-detail.component';

@Component({
  selector: 'app-event-feed-item',
  standalone: true,
  imports: [DatePipe, ButtonModule, Tag, EventDetailComponent],
  template: `
    <div
      class="cursor-pointer rounded-md border border-slate-200 bg-white transition-colors hover:border-slate-300"
      [class.border-teal-300]="detail() !== null"
      (click)="itemSelect.emit()"
      (keydown.enter)="itemSelect.emit()"
      tabindex="0"
      [attr.aria-label]="item().title"
      role="button"
    >
      <div class="flex items-start gap-3 px-4 py-3">
        <!-- Source badge -->
        <span
          class="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          [class.bg-teal-50]="item().source_type === 'event'"
          [class.text-teal-700]="item().source_type === 'event'"
          [class.bg-slate-100]="item().source_type === 'marker'"
          [class.text-slate-500]="item().source_type === 'marker'"
        >
          {{ item().source_type }}
        </span>

        <!-- Main content -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400">{{ item().event_date | date:'mediumDate' }}</span>
            @if (item().priority === 'high') {
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-red-500" title="High priority"></span>
            }
            <span class="text-xs text-slate-400">{{ item().category_name }}</span>
          </div>
          <p class="mt-0.5 text-sm font-medium text-slate-900">{{ item().title }}</p>
          <div class="mt-1 flex items-center gap-2 text-xs text-slate-400">
            @if (item().company_name && item().entity_level !== 'space') {
              <span>{{ item().company_name }}</span>
            }
            @if (item().entity_level !== 'space' && item().entity_level !== 'company' && item().entity_name) {
              <span class="text-slate-300">/</span>
              <span>{{ item().entity_name }}</span>
            }
            @if (item().entity_level === 'space') {
              <span>Industry</span>
            }
          </div>
          @if (item().tags.length > 0) {
            <div class="mt-1.5 flex flex-wrap gap-1">
              @for (tag of item().tags; track tag) {
                <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{{ tag }}</span>
              }
            </div>
          }
          @if (item().has_thread) {
            <span class="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400">
              <i class="fa-solid fa-link text-[8px]"></i> Part of a thread
            </span>
          }
        </div>

        <!-- Actions (events only) -->
        @if (item().source_type === 'event') {
          <div class="flex gap-1">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              (click)="onEdit($event)"
              aria-label="Edit event"
            >
              <i class="fa-solid fa-pen text-xs"></i>
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
              (click)="onDelete($event)"
              aria-label="Delete event"
            >
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
        }
      </div>

      <!-- Expanded detail -->
      @if (detail(); as d) {
        <div class="border-t border-slate-100 px-4 py-3">
          <app-event-detail [detail]="d" />
        </div>
      }
    </div>
  `,
})
export class EventFeedItemComponent {
  readonly item = input.required<FeedItem>();
  readonly detail = input<EventDetail | null>(null);

  readonly itemSelect = output<void>();
  readonly edit = output<void>();
  readonly deleteItem = output<void>();

  onEdit(event: MouseEvent): void {
    event.stopPropagation();
    this.edit.emit();
  }

  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.deleteItem.emit();
  }
}
