import type { ColumnDef, FilterState, FilterValue } from './filter-types';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Resolve a dotted field path on a row. Safe against missing intermediates.
 */
function getField(row: unknown, field: string): unknown {
  let current: unknown = row;
  for (const segment of field.split('.')) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function applyGlobalSearch<T>(rows: T[], query: string, fields: string[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    fields.some((f) => {
      const v = getField(row, f);
      return v != null && String(v).toLowerCase().includes(q);
    })
  );
}

export function applyColumnFilters<T>(
  rows: T[],
  filters: Record<string, FilterValue>,
  columns: ColumnDef<T>[]
): T[] {
  const columnsByField = new Map(columns.map((c) => [c.field, c]));
  const entries = Object.entries(filters);
  if (entries.length === 0) return rows;

  return rows.filter((row) =>
    entries.every(([field, value]) => {
      const col = columnsByField.get(field);
      const raw = col?.getValue ? col.getValue(row) : getField(row, field);
      return matchFilter(raw, value);
    })
  );
}

function matchFilter(raw: unknown, filter: FilterValue): boolean {
  switch (filter.kind) {
    case 'text': {
      if (raw == null) return false;
      return String(raw).toLowerCase().includes(filter.contains.toLowerCase());
    }
    case 'select': {
      if (filter.values.length === 0) return true;
      return filter.values.some((v) => v === raw);
    }
    case 'numeric': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
      switch (filter.op) {
        case 'eq':
          return raw === filter.value;
        case 'gte':
          return raw >= filter.value;
        case 'lte':
          return raw <= filter.value;
        case 'gt':
          return raw > filter.value;
        case 'lt':
          return raw < filter.value;
      }
      break;
    }
    case 'date': {
      if (raw == null) return false;
      const s = String(raw);
      if (filter.from && s < filter.from) return false;
      if (filter.to && s > filter.to) return false;
      return true;
    }
  }
}

export function applySort<T>(
  rows: T[],
  sort: { field: string; order: 1 | -1 } | null
): T[] {
  if (!sort) return rows;
  // Decorate-sort-undecorate for stable sort with numeric fallback.
  const decorated = rows.map((row, index) => ({
    row,
    index,
    key: getField(row, sort.field),
  }));
  decorated.sort((a, b) => {
    const av = a.key;
    const bv = b.key;
    if (av == null && bv == null) return a.index - b.index;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = collator.compare(String(av), String(bv));
    }
    if (cmp !== 0) return sort.order === 1 ? cmp : -cmp;
    return a.index - b.index; // stable
  });
  return decorated.map((d) => d.row);
}

export function applyPage<T>(rows: T[], page: { first: number; rows: number }): T[] {
  return rows.slice(page.first, page.first + page.rows);
}

/**
 * Compose the full pipeline. Returns the visible page plus the post-filter
 * total count for pagination display.
 */
export function applyAll<T>(
  rows: T[],
  state: FilterState,
  columns: ColumnDef<T>[],
  globalSearchFields: string[]
): { rows: T[]; total: number } {
  const searched = applyGlobalSearch(rows, state.globalSearch, globalSearchFields);
  const filtered = applyColumnFilters(searched, state.filters, columns);
  const sorted = applySort(filtered, state.sort);
  const paged = applyPage(sorted, state.page);
  return { rows: paged, total: filtered.length };
}
