// Human-readable labels for the `warnings` codes the source-import worker returns.
// Kept as pure logic (not inline on the review component) so each mapping is unit
// tested and the review page just renders the result.

const WARNING_LABELS: Record<string, string> = {
  empty_extraction:
    'No companies, assets, or trials could be extracted from this source. The text may be too short, off-topic, or in a format the model did not recognize.',
};

/**
 * Map a worker warning code to a user-facing sentence.
 *
 * Prefix codes carry a payload after the colon (e.g. `ctgov_partial:trial_3`,
 * `nct_chunk_failed:<reason>`), so they are matched by prefix; exact codes fall
 * through the static map, and an unknown code returns verbatim (better a raw code
 * than a blank warning).
 */
export function importWarningLabel(code: string): string {
  if (code.startsWith('ctgov_partial:')) {
    return 'Some trial enrichment from ClinicalTrials.gov failed. You can still commit, but CT.gov fields may be incomplete.';
  }
  // A sub-batch of a chunked NCT import timed out or failed to resolve, so the
  // trials in that batch were skipped (the rest still imported). See #178.
  if (code.startsWith('nct_chunk_failed:')) {
    return 'Part of the batch could not be resolved in time, so some trials were skipped. Re-import the missing NCT IDs to try again.';
  }
  return WARNING_LABELS[code] ?? code;
}
