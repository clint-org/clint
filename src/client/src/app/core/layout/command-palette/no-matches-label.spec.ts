import { describe, it, expect } from 'vitest';
import { noMatchesLabel } from './no-matches-label';

describe('noMatchesLabel', () => {
  it('names the scope when one is provided', () => {
    expect(noMatchesLabel('BI')).toBe('No matches in BI.');
  });

  it('omits the scope clause when it is empty (no "No matches in .")', () => {
    expect(noMatchesLabel('')).toBe('No matches.');
  });

  it('treats whitespace-only scope as empty', () => {
    expect(noMatchesLabel('   ')).toBe('No matches.');
  });
});
