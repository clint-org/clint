/**
 * Formats a count badge label as "N noun" with singular/plural agreement,
 * e.g. formatCountLabel(3, 'event') -> "3 events". Most nouns pluralize by
 * appending "s"; pass an explicit plural for irregular cases
 * (formatCountLabel(2, 'entry', 'entries') -> "2 entries"). When no noun is
 * supplied the bare count is returned. Pure so the section-card shell can use
 * it in a computed and it can be unit-tested without a DOM.
 */
export function formatCountLabel(count: number, singular: string, plural = ''): string {
  if (!singular) return `${count}`;
  const noun = count === 1 ? singular : plural || `${singular}s`;
  return `${count} ${noun}`;
}
