/**
 * Build the accessible name for a clickable list row ("View details for X").
 *
 * Rows that bind a possibly-empty display title (detected events have no
 * stored `title`; their visible label is composed from the change summary)
 * must never produce "View details for null" or a dangling "View details for ".
 * Pass the already-resolved visible title; this returns a stable, non-empty
 * accessible name. (Persona fix P2.5.)
 */
export function viewDetailsLabel(titleDisplay: string | null | undefined): string {
  const title = (titleDisplay ?? '').trim();
  return `View details for ${title || 'this event'}`;
}
