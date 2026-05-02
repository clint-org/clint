/**
 * Watermark comparison for the CT.gov sync pipeline.
 *
 * Pure function: decides whether the worker should fetch a full study
 * payload based on CT.gov's last_update_post_date vs ours. ISO date
 * strings (YYYY-MM-DD) compare correctly as plain strings.
 */

// needsFullPull returns true when CT.gov reports a newer post date than
// ours, or when we have no recorded post date yet. Returns false when
// dates are equal or when CT.gov goes backwards (defensive: should not
// happen, but never re-pull in that case).
export function needsFullPull(ctgovPostDate: string, ourLastPostDate: string | null): boolean {
  if (ourLastPostDate === null) return true;
  return ctgovPostDate > ourLastPostDate;
}
