/**
 * Type-to-confirm gate for the destructive super-admin agency delete.
 *
 * The confirm button is only enabled when the typed text exactly matches the
 * agency name (after trimming surrounding whitespace on both sides). An empty
 * agency name never matches, so a blank target can never auto-confirm.
 *
 * Pure and framework-free so it can be unit tested without TestBed.
 */
export function agencyDeleteConfirmed(typed: string, agencyName: string): boolean {
  const target = agencyName.trim();
  if (target.length === 0) return false;
  return typed.trim() === target;
}
