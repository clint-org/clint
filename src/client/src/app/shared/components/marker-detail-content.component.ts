import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { MarkerChangeRow } from '../../core/models/change-event.model';
import { ChangeEventService } from '../../core/services/change-event.service';
import { MaterialsSectionComponent } from './materials-section/materials-section.component';

@Component({
  selector: 'app-marker-detail-content',
  standalone: true,
  imports: [DatePipe, JsonPipe, MaterialsSectionComponent],
  template: `
    @if (detail(); as d) {
      <!-- Title -->
      <h2 class="mb-3 text-sm font-semibold leading-snug text-slate-900">
        {{ d.catalyst.title }}
      </h2>

      <!-- Projection / no longer expected badges -->
      @if (projectionLabel()) {
        <div class="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
          <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
          <span class="text-[10px] font-medium text-amber-700">{{ projectionLabel() }}</span>
        </div>
      }
      @if (d.catalyst.no_longer_expected) {
        <div class="mb-2 ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
          <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
          <span class="text-[10px] font-medium text-slate-500">No longer expected</span>
        </div>
      }

      <!-- Program -->
      @if (d.catalyst.company_name) {
        <div class="mb-3 border-b border-slate-100 pb-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Program
          </p>
          <div class="flex items-center gap-2 text-xs text-slate-900">
            @if (d.catalyst.company_logo_url) {
              <img
                [src]="d.catalyst.company_logo_url"
                [alt]="d.catalyst.company_name"
                class="h-5 w-5 rounded object-contain flex-none"
              />
            }
            <p>
              <span class="font-semibold uppercase">{{ d.catalyst.company_name }}</span>
              @if (d.catalyst.product_name) {
                &middot; {{ d.catalyst.product_name }}
              }
            </p>
          </div>
        </div>
      }

      <!-- Trial -->
      @if (d.catalyst.trial_name) {
        <div class="mb-3 border-b border-slate-100 pb-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
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
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Source
          </p>
          <a
            [href]="d.catalyst.source_url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 hover:underline"
          >
            {{ extractDomain(d.catalyst.source_url) }}
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
          </a>
        </div>
      }

      <!-- Upcoming for this trial -->
      @if (d.upcoming_markers.length > 0) {
        <div class="mb-4">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Upcoming for this trial
          </p>
          <ul class="space-y-1">
            @for (um of d.upcoming_markers; track um.marker_id) {
              <li
                class="cursor-pointer border-b border-slate-100 py-1.5 text-[11px] text-slate-600 hover:text-brand-700"
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
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Related events
          </p>
          <ul class="space-y-1">
            @for (re of d.related_events; track re.event_id) {
              <li class="text-[11px] text-slate-500">
                {{ re.event_date | date: 'mediumDate' }} &middot; {{ re.title }}
                <span class="text-slate-500">({{ re.category_name }})</span>
              </li>
            }
          </ul>
        </div>
      }

      <!-- Materials linked to this marker -->
      @if (spaceId()) {
        <div class="mb-2 border-t border-slate-100 pt-3">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Materials
          </p>
          <app-materials-section
            entityType="marker"
            [entityId]="d.catalyst.marker_id"
            [spaceId]="spaceId()!"
          />
        </div>
      }

      <!-- History (collapsible audit log) -->
      <div class="mt-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left focus:outline-none"
          (click)="toggleHistory()"
          [attr.aria-expanded]="historyOpen()"
          aria-controls="marker-history-panel"
        >
          <span class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            History
          </span>
          <i
            class="fa-solid text-[10px] text-slate-400"
            [class.fa-chevron-right]="!historyOpen()"
            [class.fa-chevron-down]="historyOpen()"
            aria-hidden="true"
          ></i>
        </button>

        @if (historyOpen()) {
          <div id="marker-history-panel" class="mt-2">
            @if (historyLoading()) {
              <p class="py-2 text-[11px] text-slate-400">Loading history...</p>
            } @else if (history() === null) {
              <!-- not loaded yet, nothing to show -->
            } @else if (history()!.length === 0) {
              <p class="py-2 text-[11px] text-slate-400">No history recorded.</p>
            } @else {
              <ul class="space-y-1">
                @for (row of history(); track row.id) {
                  <li class="border-b border-slate-100 py-1.5 last:border-b-0">
                    <button
                      type="button"
                      class="flex w-full items-start justify-between gap-2 text-left focus:outline-none"
                      (click)="toggleRow(row.id)"
                      [attr.aria-expanded]="isRowExpanded(row.id)"
                    >
                      <div class="min-w-0 flex-1">
                        <div
                          class="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-slate-500"
                        >
                          <span
                            class="font-semibold"
                            [class.text-green-600]="row.change_type === 'created'"
                            [class.text-blue-600]="row.change_type === 'updated'"
                            [class.text-red-600]="row.change_type === 'deleted'"
                          >
                            {{ changeTypeLabel(row.change_type) }}
                          </span>
                          <span>&middot;</span>
                          <span class="tabular-nums">{{ row.changed_at | date: 'medium' }}</span>
                        </div>
                        <div class="mt-0.5 text-[11px] text-slate-600">
                          {{ row.changed_by_email ?? 'system' }}
                        </div>
                      </div>
                      <i
                        class="fa-solid mt-1 text-[9px] text-slate-400"
                        [class.fa-chevron-right]="!isRowExpanded(row.id)"
                        [class.fa-chevron-down]="isRowExpanded(row.id)"
                        aria-hidden="true"
                      ></i>
                    </button>
                    @if (isRowExpanded(row.id)) {
                      <div class="mt-2 grid grid-cols-2 gap-2">
                        <div>
                          <p
                            class="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400"
                          >
                            Old
                          </p>
                          <pre
                            class="overflow-x-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700"
                            >{{ row.old_values | json }}</pre
                          >
                        </div>
                        <div>
                          <p
                            class="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400"
                          >
                            New
                          </p>
                          <pre
                            class="overflow-x-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700"
                            >{{ row.new_values | json }}</pre
                          >
                        </div>
                      </div>
                    }
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    }
  `,
})
export class MarkerDetailContentComponent {
  private changeEventService = inject(ChangeEventService);

  readonly detail = input<CatalystDetail | null>(null);
  /**
   * Optional space id. When set, a small Materials section renders at the
   * bottom of the panel for materials linked to this marker. Marker
   * tooltips hosted outside a space context (e.g. in the agency portal
   * preview) leave this unset and skip the section.
   */
  readonly spaceId = input<string | null>(null);
  readonly markerClick = output<string>();

  protected readonly historyOpen = signal(false);
  protected readonly history = signal<MarkerChangeRow[] | null>(null);
  protected readonly historyLoading = signal(false);
  private readonly expandedRows = signal<Set<string>>(new Set());

  protected projectionLabel = computed(() => {
    const d = this.detail();
    if (!d) return '';
    switch (d.catalyst.projection) {
      case 'stout':
        return 'Stout estimate';
      case 'company':
        return 'Company guidance';
      case 'primary':
        return 'Primary source estimate';
      case 'actual':
      default:
        return '';
    }
  });

  protected extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  protected toggleHistory(): void {
    const next = !this.historyOpen();
    this.historyOpen.set(next);
    if (next && this.history() === null && !this.historyLoading()) {
      this.loadHistory();
    }
  }

  private async loadHistory(): Promise<void> {
    const markerId = this.detail()?.catalyst.marker_id;
    if (!markerId) return;
    this.historyLoading.set(true);
    try {
      const rows = await this.changeEventService.getMarkerHistory(markerId);
      this.history.set(rows);
    } catch {
      this.history.set([]);
    } finally {
      this.historyLoading.set(false);
    }
  }

  protected toggleRow(id: string): void {
    const next = new Set(this.expandedRows());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.expandedRows.set(next);
  }

  protected isRowExpanded(id: string): boolean {
    return this.expandedRows().has(id);
  }

  protected changeTypeLabel(t: MarkerChangeRow['change_type']): string {
    switch (t) {
      case 'created':
        return 'Created';
      case 'updated':
        return 'Updated';
      case 'deleted':
        return 'Deleted';
    }
  }
}
