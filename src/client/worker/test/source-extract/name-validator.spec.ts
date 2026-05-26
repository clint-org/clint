import { describe, it, expect } from 'vitest';
import {
  normalizeForMatch,
  isNameSubstring,
} from '../../source-extract/name-validator';

describe('normalizeForMatch', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeForMatch('Pfizer, Inc.')).toBe('pfizer inc');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeForMatch('  hello  ')).toBe('hello');
  });
});

describe('isNameSubstring', () => {
  it('finds case-insensitive matches', () => {
    expect(isNameSubstring('Pfizer', 'Results from Pfizer show growth')).toBe(
      true,
    );
  });

  it('handles punctuation differences', () => {
    expect(
      isNameSubstring('Pfizer, Inc.', 'Results from Pfizer Inc show growth'),
    ).toBe(true);
  });

  it('returns false for non-matching names', () => {
    expect(
      isNameSubstring('Novartis', 'Pfizer reported strong Q1 results'),
    ).toBe(false);
  });
});
