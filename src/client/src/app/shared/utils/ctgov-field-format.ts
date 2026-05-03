import { CTGOV_FIELD_CATALOGUE, CtgovField } from '../../core/models/ctgov-field.model';

/** Walk a dotted JSON path (e.g. 'protocolSection.identificationModule.nctId') against a snapshot payload. */
export function walkCtgovPath(snap: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = snap;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function lookupCtgovField(path: string): CtgovField | undefined {
  return CTGOV_FIELD_CATALOGUE.find((f) => f.path === path);
}

/**
 * Format a single field value as a single-line string for inline / table-cell
 * display. Long-text and array values are truncated; null/undefined returns
 * empty string so callers can choose their own placeholder.
 */
export function formatCtgovFieldValue(snap: unknown, path: string): string {
  const field = lookupCtgovField(path);
  if (!field) return '';
  const value = walkCtgovPath(snap, path);
  if (value === null || value === undefined) return '';
  switch (field.kind) {
    case 'string':
    case 'longtext':
      return String(value);
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'boolean':
      return value === true ? 'Yes' : value === false ? 'No' : '';
    case 'date': {
      const d =
        value instanceof Date
          ? value
          : typeof value === 'string' || typeof value === 'number'
            ? new Date(value)
            : null;
      return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
    }
    case 'array': {
      if (!Array.isArray(value)) return '';
      if (field.summary === 'count') return `${value.length} items`;
      const items = value
        .map((v) =>
          field.itemPath && typeof v === 'object' && v !== null
            ? (v as Record<string, unknown>)[field.itemPath]
            : v
        )
        .filter((v): v is string | number | boolean => v !== null && v !== undefined);
      return items.join(', ');
    }
  }
}
