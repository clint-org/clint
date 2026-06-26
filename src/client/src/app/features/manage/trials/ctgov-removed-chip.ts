import { formatDate } from '@angular/common';

/** Tooltip/text for the "Removed from CT.gov" indicator. Null when the trial
 *  is live (no withdrawal timestamp). The date is the day CT.gov first 404'd
 *  the NCT (our detection date). */
export function ctgovRemovedChip(
  iso: string | null | undefined,
): { text: string; tooltip: string } | null {
  if (!iso) return null;
  const day = formatDate(iso, 'mediumDate', 'en-US');
  return {
    text: 'Removed from CT.gov',
    tooltip:
      `This trial's record was removed from the ClinicalTrials.gov registry on ` +
      `${day} and no longer resolves. This is distinct from the trial's clinical status.`,
  };
}
