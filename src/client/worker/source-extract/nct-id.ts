// Canonical ClinicalTrials.gov registry id is "NCT" + 8 digits. The model may
// echo it with surrounding whitespace, lowercase, or a "ClinicalTrials.gov:"
// style prefix; anything that does not reduce to NCT######## is not a registry
// id and must be dropped rather than written to trials.identifier as garbage.
const NCT_REGEX = /NCT\d{8}/i;

export function normalizeNctId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(NCT_REGEX);
  return match ? match[0].toUpperCase() : null;
}
