/**
 * Empty-results message for the command palette. Names the scope when one is
 * known, and degrades to a plain message when it is not -- avoiding the
 * "No matches in ." that appeared when the space name was unavailable.
 */
export function noMatchesLabel(scopeLabel: string): string {
  const scope = scopeLabel.trim();
  return scope ? `No matches in ${scope}.` : 'No matches.';
}
