/**
 * Canonical ClinicalTrials.gov study URL builder.
 *
 * Returns the URL for a given NCT identifier, or null when the identifier
 * is null, undefined, empty, or whitespace only.
 *
 * Hardcoded duplicates to repoint in later tasks (S2 / C3 / C5):
 *   - src/client/src/app/features/manage/trials/trial-detail.component.html
 *     (line ~96: `'https://clinicaltrials.gov/study/' + t.identifier`)
 *   - supabase/migrations/20260527120100_events_rpc_unified_feed.sql
 *   - supabase/migrations/20260528050000_feed_rpcs_prefer_trial_acronym.sql
 *   - supabase/migrations/20260618140000_events_feed_status_glyph.sql
 *   - supabase/migrations/20260627130000_ctgov_trial_dates_markers.sql
 *   - supabase/migrations/20260503060000_seed_ctgov_markers_on_sync.sql
 */
export function ctgovRegistryUrl(identifier: string | null | undefined): string | null {
  const trimmed = identifier?.trim() ?? '';
  if (!trimmed) return null;
  return `https://clinicaltrials.gov/study/${trimmed}`;
}
