/**
 * Build a descriptive export filename: `{space}-{view}-{YYYY-MM-DD}.{ext}`.
 *
 * Replaces the generic `clinical-trial-dashboard.png` / `bullseye.png` names
 * so an analyst exporting for a deck gets a file that names the engagement,
 * the view, and the date (P1.1 / UI-21). The space segment is slugified and
 * omitted when no space name is available, so the result is always a valid,
 * non-empty filename. Date is formatted in UTC to match the app's date
 * convention and keep the output deterministic.
 */

export interface ExportFilenameParts {
  /** Space / engagement name; slugified. Omitted from the name when empty. */
  space?: string | null;
  /** Short view identifier, e.g. 'timeline', 'bullseye', 'heatmap'. */
  view: string;
  /** File extension without the dot, e.g. 'png', 'pptx', 'xlsx'. */
  ext: string;
  /** The export date. */
  date: Date;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function utcDateStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The filename without an extension: `{space}-{view}-{YYYY-MM-DD}`. Used by
 * export paths that append their own extension (e.g. the sheet-excel service).
 */
export function buildExportStem(parts: Omit<ExportFilenameParts, 'ext'>): string {
  const segments = [
    parts.space ? slugify(parts.space) : '',
    slugify(parts.view),
    utcDateStamp(parts.date),
  ].filter((s) => s.length > 0);
  return segments.join('-') || 'export';
}

export function buildExportFilename(parts: ExportFilenameParts): string {
  return `${buildExportStem(parts)}.${parts.ext}`;
}
