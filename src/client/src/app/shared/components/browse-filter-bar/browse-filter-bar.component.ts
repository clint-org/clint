import { Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

/**
 * Shape of a single active-filter chip rendered below the toolbar.
 * Pages own how they map their state into chips (and how `field` and `id`
 * are interpreted on remove); this component just renders + emits.
 */
export interface BrowseFilterChip {
  /** Logical filter slot, e.g. 'entityTypes', 'type'. */
  field: string;
  /** Short label shown before the value, e.g. 'Type'. */
  header: string;
  /** Display value, e.g. 'Briefing'. */
  value: string;
  /** Stable identifier for this chip within `field`. */
  id: string;
}

/**
 * Shared filter-bar shell for browse views (intelligence, materials, ...).
 * Provides the toolbar wrapper, the optional clear-all action, the
 * right-aligned tally, and the active-chip strip below. The actual
 * controls (multiselects, search, segments) are projected as content so
 * each page keeps ownership of its own filter state and option lists.
 *
 * Visual language matches `app-landscape-filter-bar` so all three views
 * read as one product surface.
 */
@Component({
  selector: 'app-browse-filter-bar',
  standalone: true,
  imports: [ButtonModule],
  template: `
    <div class="border-b border-slate-200 bg-white">
      <div
        class="flex flex-wrap items-center gap-1.5 px-3 py-1.5"
        role="toolbar"
        [attr.aria-label]="ariaLabel()"
      >
        <ng-content />
        @if (hasActive()) {
          <p-button
            label="Clear"
            severity="secondary"
            [text]="true"
            size="small"
            (onClick)="clearAll.emit()"
          />
        }
        @if (resultLabel()) {
          <span
            class="ml-auto font-mono text-[10px] uppercase tracking-wider tabular-nums text-slate-400"
          >
            {{ resultLabel() }}
          </span>
        }
      </div>

      @if (chips().length > 0) {
        <div
          class="flex flex-wrap items-center gap-1.5 px-3 pb-1.5"
          role="list"
          aria-label="Active filters"
        >
          @for (chip of chips(); track chipKey(chip)) {
            <span
              role="listitem"
              class="inline-flex items-center gap-1.5 border border-slate-200 border-l-[3px] border-l-brand-600 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800"
            >
              <span class="text-slate-500">{{ chip.header }}:</span>
              <span>{{ chip.value }}</span>
              <button
                type="button"
                class="-mr-0.5 ml-0.5 rounded text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                [attr.aria-label]="'Remove ' + chip.header + ' ' + chip.value + ' filter'"
                (click)="chipRemove.emit(chip)"
              >
                <i class="fa-solid fa-xmark text-[10px]"></i>
              </button>
            </span>
          }
        </div>
      }
    </div>
  `,
})
export class BrowseFilterBarComponent {
  readonly chips = input<BrowseFilterChip[]>([]);
  readonly hasActive = input<boolean>(false);
  readonly resultLabel = input<string | null>(null);
  readonly ariaLabel = input<string>('Filters');

  readonly chipRemove = output<BrowseFilterChip>();
  readonly clearAll = output<void>();

  readonly hasChips = computed(() => this.chips().length > 0);

  protected chipKey(chip: BrowseFilterChip): string {
    return `${chip.field}/${chip.id}`;
  }
}
