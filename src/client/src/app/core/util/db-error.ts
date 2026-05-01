/**
 * Map a Supabase PostgrestError to a user-facing "<Field> is required" message
 * for NOT NULL (23502) and FK (23503) constraint violations. Returns null if
 * the error is not a recognized constraint violation so the caller can fall
 * back to its generic copy.
 *
 * `columnLabels` is the per-form map of DB column name to user-visible field
 * label, e.g. `{ product_id: 'Product', therapeutic_area_id: 'Therapeutic area' }`.
 * Unknown columns fall back to a humanized form of the raw column name.
 */
export function extractConstraintMessage(
  err: unknown,
  columnLabels: Record<string, string>
): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof e.code === 'string' ? e.code : null;
  const message = typeof e.message === 'string' ? e.message : '';
  const details = typeof e.details === 'string' ? e.details : '';

  if (code === '23502') {
    // e.g. null value in column "product_id" of relation "trials" violates not-null constraint
    const col = /column "([^"]+)"/.exec(message)?.[1];
    if (col) return `${labelFor(col, columnLabels)} is required.`;
  }

  if (code === '23503') {
    // details: Key (product_id)=(...) is not present in table "products".
    // message fallback: violates foreign key constraint "trials_product_id_fkey"
    const col = /Key \(([^)]+)\)/.exec(details)?.[1] ?? /_(\w+)_fkey/.exec(message)?.[1] ?? null;
    if (col) return `${labelFor(col, columnLabels)} is required.`;
  }

  return null;
}

function labelFor(col: string, columnLabels: Record<string, string>): string {
  if (col in columnLabels) return columnLabels[col];
  const humanized = col.replace(/_id$/, '').replace(/_/g, ' ');
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}
