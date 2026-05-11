import type { ColumnDef, FilterState, FilterValue } from './filter-types';

interface CodecOptions {
  /** The defaults — if state matches these, they're omitted from the encoded URL. */
  defaultPage: { first: number; rows: number };
}

/**
 * Encode a FilterState into a plain query-param map. Values use the schema
 * documented in spec section 8. Defaults are omitted so unfiltered grids have
 * clean URLs.
 */
export function encodeFilterState(
  state: FilterState,
  options: CodecOptions
): Record<string, string> {
  const out: Record<string, string> = {};

  if (state.globalSearch) {
    out['q'] = state.globalSearch;
  }

  for (const [field, value] of Object.entries(state.filters)) {
    const encoded = encodeFilterValue(value);
    if (encoded !== null) {
      out[`filter.${field}`] = encoded;
    }
  }

  if (state.sort) {
    out['sort'] = state.sort.order === 1 ? state.sort.field : `-${state.sort.field}`;
  }

  const { defaultPage } = options;
  if (state.page.rows !== defaultPage.rows) {
    out['pageSize'] = String(state.page.rows);
  }
  if (state.page.first !== defaultPage.first) {
    const pageNumber = Math.floor(state.page.first / state.page.rows) + 1;
    out['page'] = String(pageNumber);
  }

  return out;
}

function encodeFilterValue(value: FilterValue): string | null {
  switch (value.kind) {
    case 'text':
      return value.contains ? value.contains : null;
    case 'select':
      return value.values.length > 0 ? value.values.map(String).join(',') : null;
    case 'numeric':
      return value.op === 'eq' ? String(value.value) : `${value.op}:${value.value}`;
    case 'date':
      if (value.from === null && value.to === null) return null;
      return `${value.from ?? ''}..${value.to ?? ''}`;
  }
}

/**
 * Decode a query-param map back into FilterState. Accepts either a
 * single-value string or a string[] per key (for repeated-param form of
 * multi-value selects). Invalid values are dropped with a console warning.
 */
export function decodeFilterState<T>(
  params: Map<string, string | string[]>,
  columns: ColumnDef<T>[],
  options: CodecOptions
): FilterState {
  const columnsByField = new Map(columns.map((c) => [c.field, c]));

  const state: FilterState = {
    globalSearch: '',
    filters: {},
    sort: null,
    page: { ...options.defaultPage },
  };

  for (const [key, rawValue] of params.entries()) {
    const value = Array.isArray(rawValue) ? rawValue : rawValue;

    if (key === 'q') {
      state.globalSearch = firstString(value);
      continue;
    }

    if (key === 'sort') {
      const v = firstString(value);
      if (v.startsWith('-')) {
        state.sort = { field: v.slice(1), order: -1 };
      } else if (v) {
        state.sort = { field: v, order: 1 };
      }
      continue;
    }

    if (key === 'page') {
      const n = parseInt(firstString(value), 10);
      if (Number.isFinite(n) && n >= 1) {
        state.page = {
          ...state.page,
          first: (n - 1) * state.page.rows,
        };
      }
      continue;
    }

    if (key === 'pageSize') {
      const n = parseInt(firstString(value), 10);
      if (Number.isFinite(n) && n > 0) {
        state.page = { ...state.page, rows: n };
      }
      continue;
    }

    if (key.startsWith('filter.')) {
      const field = key.slice('filter.'.length);
      const col = columnsByField.get(field);
      if (!col || !col.filter) {
        console.warn(`[grid] Dropping filter for unknown or non-filterable field: ${field}`);
        continue;
      }
      const parsed = parseFilterValue(col.filter.kind, value);
      if (parsed !== null) {
        state.filters[field] = parsed;
      } else {
        console.warn(
          `[grid] Dropping malformed filter value for ${field}: ${JSON.stringify(value)}`
        );
      }
    }
  }

  return state;
}

function firstString(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function parseFilterValue(
  kind: 'text' | 'select' | 'numeric' | 'date',
  raw: string | string[]
): FilterValue | null {
  switch (kind) {
    case 'text': {
      const v = firstString(raw);
      return v ? { kind: 'text', contains: v } : null;
    }
    case 'select': {
      if (Array.isArray(raw)) {
        return raw.length > 0 ? { kind: 'select', values: raw.slice() } : null;
      }
      const values = raw.split(',').filter((s) => s.length > 0);
      return values.length > 0 ? { kind: 'select', values } : null;
    }
    case 'numeric': {
      const v = firstString(raw);
      const match = /^(gte|lte|gt|lt):(-?\d+(\.\d+)?)$/.exec(v);
      if (match) {
        return {
          kind: 'numeric',
          op: match[1] as 'gte' | 'lte' | 'gt' | 'lt',
          value: Number(match[2]),
        };
      }
      const bare = Number(v);
      return Number.isFinite(bare) ? { kind: 'numeric', op: 'eq', value: bare } : null;
    }
    case 'date': {
      const v = firstString(raw);
      const m = /^([^.]*)\.\.(.*)$/.exec(v);
      if (!m) return null;
      const from = m[1] || null;
      const to = m[2] || null;
      if (from === null && to === null) return null;
      return { kind: 'date', from, to };
    }
  }
}

/**
 * Build query params for deep-linking into a grid with specific filters
 * pre-applied. Thin wrapper over encodeFilterState for the common case of
 * "just set these filters, start on page 1, default page size, no sort".
 * Consumers like company-list::openAssets() use this so they don't have
 * to know the full URL schema.
 */
export function buildFilterQueryParams(
  filters: Record<string, FilterValue>,
  pageSize = 25
): Record<string, string> {
  return encodeFilterState(
    {
      globalSearch: '',
      filters,
      sort: null,
      page: { first: 0, rows: pageSize },
    },
    { defaultPage: { first: 0, rows: pageSize } }
  );
}
