import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';

export interface HistoryFieldDiff {
  /** Raw column / payload key. */
  field: string;
  /** Human label shown in the diff table (e.g. "Event date"). */
  label: string;
  /** Pre-formatted display value. Null when the field was unset. */
  before: string | null;
  /** Pre-formatted display value. Null when the field was unset. */
  after: string | null;
}

export interface HistoryEntry {
  id: string;
  changeType: 'created' | 'updated' | 'deleted';
  /** ISO timestamp. */
  changedAt: string;
  changedBy: string | null;
  diffs: HistoryFieldDiff[];
  /**
   * Optional raw payload pair for the "View raw JSON" engineering case.
   * When omitted, the toggle does not render.
   */
  raw?: { old: unknown; new: unknown };
}

const CHANGE_TYPE_LABEL: Record<HistoryEntry['changeType'], string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
};

const CHANGE_TYPE_COLOR: Record<HistoryEntry['changeType'], string> = {
  created: 'text-green-700',
  updated: 'text-blue-700',
  deleted: 'text-red-700',
};

/**
 * Audit trail primitive for detail panes. Renders a collapsible "History"
 * section. When expanded, each entry shows a Field | Before | After diff
 * table with an optional "View raw JSON" toggle for the engineering case.
 *
 * Caller is responsible for fetching the raw rows and projecting them into
 * HistoryEntry shape (label fields, format dates, etc). Caller wires
 * lazy-loading via the (toggle) event.
 */
@Component({
  selector: 'app-detail-panel-history',
  standalone: true,
  imports: [DatePipe, JsonPipe],
  template: `
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 text-left focus:outline-none"
      (click)="onToggle()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
    >
      <span class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        History{{ countSuffix() }}
      </span>
      <i
        class="fa-solid text-[10px] text-slate-400"
        [class.fa-chevron-right]="!open()"
        [class.fa-chevron-down]="open()"
        aria-hidden="true"
      ></i>
    </button>

    @if (open()) {
      <div [id]="panelId" class="mt-2">
        @if (loading()) {
          <p class="py-2 text-[11px] text-slate-400">Loading history...</p>
        } @else if (entries() === null) {
          <!-- caller has not yet provided entries; nothing to render -->
        } @else if (entries()!.length === 0) {
          <p class="py-2 text-[11px] text-slate-400">No history recorded.</p>
        } @else {
          <ul class="space-y-1.5">
            @for (entry of entries(); track entry.id) {
              <li>
                @if (isEntryExpanded(entry.id)) {
                  <div class="rounded-sm bg-slate-50 px-2 py-2">
                    <button
                      type="button"
                      class="flex w-full items-center justify-between gap-2 text-left"
                      (click)="toggleEntry(entry.id)"
                    >
                      <div class="flex items-center gap-2 text-[11px]">
                        <span
                          [class]="
                            'font-mono font-semibold uppercase tracking-wide ' +
                            changeTypeColor(entry.changeType)
                          "
                        >
                          {{ changeTypeLabel(entry.changeType) }}
                        </span>
                        <span class="text-slate-500">&middot;</span>
                        <span class="font-mono tabular-nums text-slate-500">
                          {{ entry.changedAt | date: 'medium' }}
                        </span>
                      </div>
                      <i
                        class="fa-solid fa-chevron-down text-[9px] text-slate-400"
                        aria-hidden="true"
                      ></i>
                    </button>
                    <p class="mt-0.5 text-[11px] text-slate-600">
                      {{ entry.changedBy ?? 'system' }}
                    </p>
                    @if (entry.diffs.length > 0) {
                      <table class="mt-2 w-full text-[11px]">
                        <thead>
                          <tr
                            class="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                          >
                            <th class="py-1 pr-3">Field</th>
                            <th class="py-1 pr-3">Before</th>
                            <th class="py-1">After</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                          @for (diff of entry.diffs; track diff.field) {
                            <tr>
                              <td class="py-1 pr-3 text-slate-500">{{ diff.label }}</td>
                              <td class="py-1 pr-3 text-slate-500 line-through">
                                {{ diff.before ?? '-' }}
                              </td>
                              <td class="py-1 font-medium text-slate-900">
                                {{ diff.after ?? '-' }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    } @else {
                      <p class="mt-2 text-[11px] text-slate-400">No field-level diff available.</p>
                    }
                    @if (entry.raw) {
                      <button
                        type="button"
                        class="mt-2 inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600"
                        (click)="toggleRaw(entry.id)"
                      >
                        <i class="fa-solid fa-code text-[9px]" aria-hidden="true"></i>
                        {{ isRawOpen(entry.id) ? 'Hide raw' : 'View raw' }}
                      </button>
                      @if (isRawOpen(entry.id)) {
                        <div class="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <p
                              class="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400"
                            >
                              Old
                            </p>
                            <pre
                              class="overflow-x-auto rounded bg-white p-2 text-[10px] text-slate-700 ring-1 ring-slate-200"
                              >{{ entry.raw.old | json }}</pre
                            >
                          </div>
                          <div>
                            <p
                              class="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400"
                            >
                              New
                            </p>
                            <pre
                              class="overflow-x-auto rounded bg-white p-2 text-[10px] text-slate-700 ring-1 ring-slate-200"
                              >{{ entry.raw.new | json }}</pre
                            >
                          </div>
                        </div>
                      }
                    }
                  </div>
                } @else {
                  <button
                    type="button"
                    class="flex w-full items-start justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-slate-50"
                    (click)="toggleEntry(entry.id)"
                  >
                    <div class="flex-1">
                      <div class="flex items-center gap-2 text-[11px]">
                        <span
                          [class]="
                            'font-mono font-semibold uppercase tracking-wide ' +
                            changeTypeColor(entry.changeType)
                          "
                        >
                          {{ changeTypeLabel(entry.changeType) }}
                        </span>
                        <span class="text-slate-500">&middot;</span>
                        <span class="font-mono tabular-nums text-slate-500">
                          {{ entry.changedAt | date: 'medium' }}
                        </span>
                      </div>
                      <p class="mt-0.5 text-[11px] text-slate-600">
                        {{ entry.changedBy ?? 'system' }}
                      </p>
                    </div>
                    <i
                      class="fa-solid fa-chevron-right text-[9px] text-slate-400"
                      aria-hidden="true"
                    ></i>
                  </button>
                }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelHistoryComponent {
  /**
   * null = caller has not loaded yet (e.g. waiting for first expand).
   * [] = loaded, no entries.
   * non-empty = loaded entries.
   */
  readonly entries = input<HistoryEntry[] | null>(null);
  readonly loading = input<boolean>(false);
  readonly open = input<boolean>(false);

  /** Stable id for aria-controls on the toggle button. */
  protected readonly panelId = `history-panel-${Math.random().toString(36).slice(2, 9)}`;

  readonly toggleOpen = output<void>();

  private readonly expandedEntries = signal<Set<string>>(new Set());
  private readonly rawOpenEntries = signal<Set<string>>(new Set());

  protected readonly countSuffix = computed(() => {
    const e = this.entries();
    return e && e.length > 0 ? ` (${e.length})` : '';
  });

  onToggle(): void {
    this.toggleOpen.emit();
  }

  protected toggleEntry(id: string): void {
    const next = new Set(this.expandedEntries());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedEntries.set(next);
  }

  protected isEntryExpanded(id: string): boolean {
    return this.expandedEntries().has(id);
  }

  protected toggleRaw(id: string): void {
    const next = new Set(this.rawOpenEntries());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.rawOpenEntries.set(next);
  }

  protected isRawOpen(id: string): boolean {
    return this.rawOpenEntries().has(id);
  }

  protected changeTypeLabel(t: HistoryEntry['changeType']): string {
    return CHANGE_TYPE_LABEL[t];
  }

  protected changeTypeColor(t: HistoryEntry['changeType']): string {
    return CHANGE_TYPE_COLOR[t];
  }
}
