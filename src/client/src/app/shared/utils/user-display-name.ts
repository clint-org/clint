/**
 * The display name for the signed-in user, derived from their auth identity
 * metadata: full_name -> name -> the email local-part -> 'Account'. Pure (the
 * Supabase user object is passed in decomposed) so the node unit runner tests
 * it without a TestBed.
 */
export function userDisplayName(
  fullName: string | null | undefined,
  name: string | null | undefined,
  email: string | null | undefined
): string {
  const full = (fullName ?? '').trim() || (name ?? '').trim();
  if (full) return full;
  const local = (email ?? '').split('@')[0].trim();
  return local || 'Account';
}
