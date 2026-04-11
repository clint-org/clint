import { computed, effect, inject, signal, Signal, WritableSignal } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';

import type {
  ActiveFilterChip,
  ColumnDef,
  FilterState,
  FilterValue,
  GridConfig,
  GridState,
} from './filter-types';
import { encodeFilterState, decodeFilterState } from './url-codec';
import { applyAll } from './filter-algebra';

const DEFAULT_PAGE_SIZE = 25;
const GLOBAL_SEARCH_DEBOUNCE_MS = 200;
const GLOBAL_SEARCH_CHIP_FIELD = '__q__';

/**
 * Factory that wires up a reactive grid state bound to URL query params.
 *
 * MUST be called from within an Angular injection context (component field
 * initializer or constructor). Uses inject() internally for ActivatedRoute
 * and Router, and effect() for URL sync.
 */
export function createGridState<T>(config: GridConfig<T>): GridState<T> {
  const route = inject(ActivatedRoute);
  const router = inject(Router);

  const defaultPageSize = config.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const defaultPage = { first: 0, rows: defaultPageSize };
  const initialSort = config.defaultSort ?? null;

  // --- decode initial state from URL ----------------------------------------
  const initialParams = paramsMapFromSnapshot(route.snapshot.queryParamMap);
  let initial: FilterState = decodeFilterState(initialParams, config.columns, { defaultPage });

  // Apply default sort if URL didn't specify one.
  if (!initial.sort && initialSort) {
    initial = { ...initial, sort: initialSort };
  }

  // --- core signals ---------------------------------------------------------
  const globalSearch: WritableSignal<string> = signal(initial.globalSearch);
  const debouncedGlobalSearch: WritableSignal<string> = signal(initial.globalSearch);
  const filters: WritableSignal<Record<string, FilterValue>> = signal(initial.filters);
  const sort: WritableSignal<{ field: string; order: 1 | -1 } | null> = signal(initial.sort);
  const page: WritableSignal<{ first: number; rows: number }> = signal(initial.page);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isFirstLazyLoad = true;

  function onGlobalSearchInput(value: string): void {
    globalSearch.set(value);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedGlobalSearch.set(value);
      // Reset page on search change.
      page.update((p) => ({ first: 0, rows: p.rows }));
    }, GLOBAL_SEARCH_DEBOUNCE_MS);
  }

  // --- URL sync effect ------------------------------------------------------
  effect(() => {
    const state: FilterState = {
      globalSearch: debouncedGlobalSearch(),
      filters: filters(),
      sort: sort(),
      page: page(),
    };
    const encoded = encodeFilterState(state, { defaultPage });
    const current = paramsMapFromSnapshot(route.snapshot.queryParamMap);
    if (sameParams(encoded, current)) return;
    router.navigate([], {
      relativeTo: route,
      queryParams: encoded,
      replaceUrl: true,
    });
  });

  // --- derived state --------------------------------------------------------
  const activeFilters: Signal<ActiveFilterChip[]> = computed(() => {
    const out: ActiveFilterChip[] = [];
    const q = debouncedGlobalSearch();
    if (q) {
      out.push({ field: GLOBAL_SEARCH_CHIP_FIELD, header: 'Search', label: `"${q}"` });
    }
    const columnsByField = new Map(config.columns.map((c) => [c.field, c]));
    for (const [field, value] of Object.entries(filters())) {
      const col = columnsByField.get(field);
      if (!col) continue;
      out.push({ field, header: col.header, label: formatFilterLabel(col, value) });
    }
    return out;
  });

  const isFiltered: Signal<boolean> = computed(() => activeFilters().length > 0);

  const primengFilters: Signal<Record<string, { value: unknown; matchMode: string }[]>> = computed(() => {
    const out: Record<string, { value: unknown; matchMode: string }[]> = {};
    for (const [field, value] of Object.entries(filters())) {
      switch (value.kind) {
        case 'text':
          out[field] = [{ value: value.contains, matchMode: 'contains' }];
          break;
        case 'select':
          out[field] = [{ value: value.values, matchMode: 'in' }];
          break;
        case 'numeric':
          out[field] = [{ value: value.value, matchMode: value.op }];
          break;
        case 'date':
          out[field] = [{ value: [value.from, value.to], matchMode: 'dateRange' }];
          break;
      }
    }
    return out;
  });

  // --- filteredRows + totalRecords ------------------------------------------
  // The consumer wires the raw rows signal exactly once via filteredRows(raw).
  // We stash it in a closed-over reference and use it for both the visible
  // page and the post-filter total, derived from a single applyAll() call.
  let rawRowsSignal: Signal<T[]> | null = null;

  const applyAllResult = computed(() => {
    const raw = rawRowsSignal?.() ?? [];
    const state: FilterState = {
      globalSearch: debouncedGlobalSearch(),
      filters: filters(),
      sort: sort(),
      page: page(),
    };
    return applyAll(raw, state, config.columns, config.globalSearchFields);
  });

  const filteredRows = (raw: Signal<T[]>): Signal<T[]> => {
    rawRowsSignal = raw;
    return computed(() => applyAllResult().rows);
  };

  const totalRecords: Signal<number> = computed(() => applyAllResult().total);

  // Clamp page.first if it's out of range for the current filtered total.
  // E.g., user deletes a row or loads a URL with page=9 on a small dataset.
  effect(() => {
    const total = applyAllResult().total;
    const currentPage = page();
    if (total > 0 && currentPage.first >= total) {
      const lastPageFirst = Math.max(0, Math.floor((total - 1) / currentPage.rows) * currentPage.rows);
      page.set({ first: lastPageFirst, rows: currentPage.rows });
    }
  });

  // --- event handlers wired to p-table [lazy] -------------------------------
  function onLazyLoad(event: {
    first?: number | null;
    rows?: number | null;
    sortField?: string | null;
    sortOrder?: number | null;
    filters?: Record<string, { value: unknown; matchMode?: string }[] | { value: unknown; matchMode?: string }>;
  }): void {
    // Skip the initial onLazyLoad call: PrimeNG fires it on table init with
    // stale defaults (first=0) regardless of what [first] is bound to. We
    // already have the correct state from URL decoding. Subsequent calls are
    // real user actions and we honor them fully.
    if (isFirstLazyLoad) {
      isFirstLazyLoad = false;
      return;
    }
    if (typeof event.first === 'number' && typeof event.rows === 'number') {
      page.set({ first: event.first, rows: event.rows });
    }
    if (typeof event.sortField === 'string' && event.sortOrder != null) {
      sort.set({ field: event.sortField, order: event.sortOrder >= 0 ? 1 : -1 });
    } else if (event.sortField === null) {
      sort.set(null);
    }
    if (event.filters) {
      const next: Record<string, FilterValue> = {};
      for (const [field, meta] of Object.entries(event.filters)) {
        const metaArr = Array.isArray(meta) ? meta[0] : meta;
        if (!metaArr || metaArr.value == null || metaArr.value === '') continue;
        const col = config.columns.find((c) => c.field === field);
        if (!col?.filter) continue;
        const parsed = primengToFilterValue(col.filter.kind, metaArr);
        if (parsed) next[field] = parsed;
      }
      // Only update filters + reset page when filters actually changed.
      // PrimeNG includes the full filter state on every lazy event (including
      // page/sort changes), so we must not reset page on a no-op filter pass.
      const current = filters();
      const filtersChanged =
        JSON.stringify(Object.keys(next).sort()) !== JSON.stringify(Object.keys(current).sort()) ||
        JSON.stringify(next) !== JSON.stringify(current);
      if (filtersChanged) {
        filters.set(next);
        page.update((p) => ({ first: 0, rows: p.rows }));
      }
    }
  }

  function clearAll(): void {
    globalSearch.set('');
    debouncedGlobalSearch.set('');
    filters.set({});
    page.update((p) => ({ first: 0, rows: p.rows }));
  }

  function clearFilter(field: string): void {
    if (field === GLOBAL_SEARCH_CHIP_FIELD) {
      globalSearch.set('');
      debouncedGlobalSearch.set('');
      return;
    }
    filters.update((f) => {
      const next = { ...f };
      delete next[field];
      return next;
    });
    page.update((p) => ({ first: 0, rows: p.rows }));
  }

  return {
    globalSearch,
    filters,
    sort,
    page,
    activeFilters,
    isFiltered,
    totalRecords,
    filteredRows,
    onLazyLoad,
    onGlobalSearchInput,
    primengFilters,
    clearAll,
    clearFilter,
  };
}

function paramsMapFromSnapshot(map: ParamMap): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  for (const key of map.keys) {
    const all = map.getAll(key);
    out.set(key, all.length > 1 ? all : (all[0] ?? ''));
  }
  return out;
}

function sameParams(a: Record<string, string>, b: Map<string, string | string[]>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Array.from(b.keys()).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const bv = b.get(aKeys[i]);
    const bStr = Array.isArray(bv) ? bv.join(',') : bv;
    if (a[aKeys[i]] !== bStr) return false;
  }
  return true;
}

function formatFilterLabel<T>(col: ColumnDef<T>, value: FilterValue): string {
  switch (value.kind) {
    case 'text':
      return `contains "${value.contains}"`;
    case 'select': {
      if (col.filter?.kind !== 'select') return value.values.join(', ');
      const options = col.filter.options();
      const labels = value.values.map((v) => {
        const opt = options.find((o) => o.value === v);
        return opt ? opt.label : `<${String(v)}>`;
      });
      return labels.join(', ');
    }
    case 'numeric':
      return value.op === 'eq' ? String(value.value) : `${value.op} ${value.value}`;
    case 'date':
      return `${value.from ?? ''} \u2013 ${value.to ?? ''}`;
  }
}

function primengToFilterValue(
  kind: 'text' | 'select' | 'numeric' | 'date',
  meta: { value: unknown; matchMode?: string }
): FilterValue | null {
  switch (kind) {
    case 'text':
      return typeof meta.value === 'string' && meta.value
        ? { kind: 'text', contains: meta.value }
        : null;
    case 'select': {
      const arr = Array.isArray(meta.value) ? meta.value : [meta.value];
      return arr.length > 0 && arr[0] != null ? { kind: 'select', values: arr } : null;
    }
    case 'numeric': {
      if (typeof meta.value !== 'number' || !Number.isFinite(meta.value)) return null;
      const op = (meta.matchMode ?? 'eq') as 'eq' | 'gte' | 'lte' | 'gt' | 'lt';
      return { kind: 'numeric', op, value: meta.value };
    }
    case 'date': {
      if (!Array.isArray(meta.value) || meta.value.length !== 2) return null;
      const [from, to] = meta.value as [string | null, string | null];
      return { kind: 'date', from, to };
    }
  }
}
