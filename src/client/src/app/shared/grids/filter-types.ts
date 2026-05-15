import type { Signal, WritableSignal } from '@angular/core';
import type { TableLazyLoadEvent } from 'primeng/table';

/**
 * The committed value for a single column filter. Shape depends on filter kind.
 */
export type FilterValue =
  | { kind: 'text'; contains: string }
  | { kind: 'select'; values: unknown[] }
  | { kind: 'numeric'; op: 'eq' | 'gte' | 'lte' | 'gt' | 'lt'; value: number }
  | { kind: 'date'; from: string | null; to: string | null };

/**
 * Declarative column definition. Each filterable column also drives chip labels.
 */
export interface ColumnDef<T> {
  /** Dotted path into the row view-model, e.g. 'asset.company_id' or 'companyName'. */
  field: string;
  /** Display header — also used as the chip label prefix. */
  header: string;
  /** Omit to mean "no filter on this column". */
  filter?:
    | { kind: 'text' }
    | { kind: 'select'; options: () => { label: string; value: unknown }[] }
    | { kind: 'numeric' }
    | { kind: 'date' };
  /** Default true when field is present. Set false to suppress the sort header. */
  sortable?: boolean;
  /** Optional custom value getter. Defaults to dotted-path lookup on T. */
  getValue?: (row: T) => unknown;
}

/**
 * Full grid state — serializable to/from URL query params.
 */
export interface FilterState {
  globalSearch: string;
  filters: Record<string, FilterValue>;
  sort: { field: string; order: 1 | -1 } | null;
  page: { first: number; rows: number };
}

/**
 * Config passed to createGridState by each list component.
 */
export interface GridConfig<T> {
  columns: ColumnDef<T>[];
  /** View-model paths the toolbar's global search hits. */
  globalSearchFields: string[];
  defaultSort?: { field: string; order: 1 | -1 };
  /** Default 25. */
  defaultPageSize?: number;
  /** Default [10, 25, 50, 100]. */
  pageSizeOptions?: number[];
  /**
   * When set, grid state (filters + sort + page + global search) persists to
   * `localStorage`, scoped by tenant + space. Storage key format:
   * `grid:{tenantId}:{spaceId}:{persistenceKey}`. URL params always win on
   * page load; localStorage is only consulted when the URL has no grid
   * params, so deep links remain authoritative.
   */
  persistenceKey?: string;
}

/**
 * Human-readable representation of one active filter, used by the chip row.
 */
export interface ActiveFilterChip {
  field: string;
  header: string;
  /** Formatted value to display after the header, e.g. "Pfizer" or "contains 'emp'". */
  label: string;
}

/**
 * What createGridState returns. List components bind to this in templates.
 */
export interface GridState<T> {
  readonly globalSearch: WritableSignal<string>;
  /**
   * Debounced (200ms) form of `globalSearch`. Drives row filtering and is
   * the value templates should bind to for search-term highlighting so
   * highlighted matches stay in lockstep with the visible filtered rows.
   */
  readonly debouncedGlobalSearch: Signal<string>;
  readonly filters: WritableSignal<Record<string, FilterValue>>;
  readonly sort: WritableSignal<{ field: string; order: 1 | -1 } | null>;
  readonly page: WritableSignal<{ first: number; rows: number }>;

  readonly activeFilters: Signal<ActiveFilterChip[]>;
  readonly isFiltered: Signal<boolean>;
  readonly totalRecords: Signal<number>;
  /** Length of the raw input rows (pre-filter, pre-page). 0 until filteredRows() is wired. */
  readonly rawTotal: Signal<number>;
  /**
   * True if any state diverges from defaults: search text, filters, sort, or
   * a non-first page. Templates can use this to show a `Reset to defaults`
   * affordance.
   */
  readonly isDirty: Signal<boolean>;

  filteredRows: (raw: Signal<T[]>) => Signal<T[]>;

  onLazyLoad: (e: TableLazyLoadEvent) => void;
  onGlobalSearchInput: (value: string) => void;

  /** PrimeNG filter-metadata shape derived from the unified state, for two-way binding to `<p-table [filters]>`. */
  readonly primengFilters: Signal<Record<string, { value: unknown; matchMode: string }[]>>;

  clearAll: () => void;
  clearFilter: (field: string) => void;
  /** Clears filters, sort, page, and search back to defaults; also wipes persisted state. */
  resetToDefaults: () => void;
}
