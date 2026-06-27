import { describe, expect, it } from 'vitest';

import { formatCountLabel } from './format-count-label';

describe('formatCountLabel', () => {
  it('pluralizes a regular noun by appending "s"', () => {
    expect(formatCountLabel(3, 'event')).toBe('3 events');
    expect(formatCountLabel(5, 'material')).toBe('5 materials');
  });

  it('uses the singular noun when the count is exactly one', () => {
    expect(formatCountLabel(1, 'event')).toBe('1 event');
    expect(formatCountLabel(1, 'material')).toBe('1 material');
  });

  it('uses the singular noun for a zero count plural (regression: "0 events")', () => {
    expect(formatCountLabel(0, 'event')).toBe('0 events');
  });

  it('honors an explicit plural for irregular nouns', () => {
    expect(formatCountLabel(1, 'entry', 'entries')).toBe('1 entry');
    expect(formatCountLabel(2, 'entry', 'entries')).toBe('2 entries');
    expect(formatCountLabel(0, 'entry', 'entries')).toBe('0 entries');
  });

  it('returns the bare count when no noun is supplied', () => {
    expect(formatCountLabel(7, '')).toBe('7');
  });
});
