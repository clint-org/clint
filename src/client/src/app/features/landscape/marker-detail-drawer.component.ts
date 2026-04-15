import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';

@Component({
  selector: 'app-marker-detail-drawer',
  standalone: true,
  imports: [DatePipe],
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    @if (open()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-40 bg-black/20"
        (click)="drawerClose.emit()"
        (keydown.escape)="drawerClose.emit()"
        aria-hidden="true"
      ></div>

      <!-- Drawer panel -->
      <div
        class="fixed top-0 right-0 bottom-0 z-50 flex w-[480px] max-w-[50vw] flex-col bg-white border-l border-slate-200 shadow-[-4px_0_16px_rgba(0,0,0,0.08)]"
        role="dialog"
        aria-modal="true"
        aria-label="Marker detail"
        (click)="$event.stopPropagation()"
        (keydown)="$event.stopPropagation()"
      >
        <!-- Panel header -->
        <div
          class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"
        >
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-teal-600">
              {{ detail()!.catalyst.category_name }} &middot;
              {{ detail()!.catalyst.marker_type_name }}
            </p>
          </div>
          <button
            type="button"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
            (click)="drawerClose.emit()"
            aria-label="Close detail drawer"
          >
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>

        <!-- Panel body (scrollable) -->
        <div class="flex-1 overflow-y-auto px-5 py-4">
          @if (detail(); as d) {
            <!-- Title -->
            <h2 class="mb-3 text-sm font-semibold leading-snug text-slate-900">
              {{ d.catalyst.title }}
            </h2>

            <!-- Date & Status -->
            <div class="mb-4 flex items-center gap-4 text-xs text-slate-500">
              <div>
                <span class="font-semibold">Date</span><br />
                {{ d.catalyst.event_date | date: 'mediumDate' }}
              </div>
              <div>
                <span class="font-semibold">Status</span><br />
                @if (d.catalyst.is_projected) {
                  <span class="text-amber-600">Projected</span>
                } @else {
                  <span class="text-green-600">Confirmed</span>
                }
              </div>
            </div>

            <!-- Description -->
            @if (d.catalyst.description) {
              <div class="mb-4">
                <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Description
                </p>
                <p class="text-xs leading-relaxed text-slate-600">
                  {{ d.catalyst.description }}
                </p>
              </div>
            }

            <!-- Source -->
            @if (d.catalyst.source_url) {
              <div class="mb-4">
                <p
                  class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
                >
                  Source
                </p>
                <a
                  [href]="d.catalyst.source_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 hover:underline"
                >
                  {{ d.catalyst.source_url }}
                  <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                </a>
              </div>
            }

            <!-- Trial -->
            @if (d.catalyst.trial_name) {
              <div class="mb-4">
                <p
                  class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
                >
                  Trial
                </p>
                <p class="text-xs font-medium text-slate-900">
                  {{ d.catalyst.trial_name }}
                </p>
                <p class="text-[11px] text-slate-500">
                  {{ d.catalyst.trial_phase }}
                  @if (d.catalyst.recruitment_status) {
                    &middot; {{ d.catalyst.recruitment_status }}
                  }
                </p>
              </div>
            }

            <!-- Program -->
            @if (d.catalyst.company_name) {
              <div class="mb-4">
                <p
                  class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
                >
                  Program
                </p>
                <p class="text-xs text-slate-900">
                  <span class="uppercase">{{ d.catalyst.company_name }}</span>
                  @if (d.catalyst.product_name) {
                    &middot; {{ d.catalyst.product_name }}
                  }
                </p>
              </div>
            }

            <!-- Upcoming for this trial -->
            @if (d.upcoming_markers.length > 0) {
              <div class="mb-4">
                <p
                  class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
                >
                  Upcoming for this trial
                </p>
                <ul class="space-y-1">
                  @for (um of d.upcoming_markers; track um.marker_id) {
                    <li
                      class="cursor-pointer border-b border-slate-100 py-1.5 text-[11px] text-slate-600 hover:text-teal-700"
                      (click)="markerClick.emit(um.marker_id)"
                      (keydown.enter)="markerClick.emit(um.marker_id)"
                      tabindex="0"
                      role="button"
                    >
                      {{ um.event_date | date: 'MMM yyyy' }} &middot;
                      {{ um.marker_type_name }}
                      @if (um.is_projected) {
                        <span class="text-amber-500">(projected)</span>
                      }
                    </li>
                  }
                </ul>
              </div>
            }

            <!-- Related events -->
            @if (d.related_events.length > 0) {
              <div class="mb-4">
                <p
                  class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
                >
                  Related events
                </p>
                <ul class="space-y-1">
                  @for (re of d.related_events; track re.event_id) {
                    <li class="text-[11px] text-slate-500">
                      {{ re.event_date | date: 'mediumDate' }} &mdash; {{ re.title }}
                      <span class="text-slate-300">({{ re.category_name }})</span>
                    </li>
                  }
                </ul>
              </div>
            }
          }
        </div>
      </div>
    }
  `,
})
export class MarkerDetailDrawerComponent {
  readonly detail = input<CatalystDetail | null>(null);
  readonly open = input<boolean>(false);
  readonly drawerClose = output<void>();
  readonly markerClick = output<string>();

  onEscape(): void {
    if (this.open()) {
      this.drawerClose.emit();
    }
  }
}
