import { describe, expect, it } from 'vitest';
import { parseDayOffset } from './parse-day-offset';

describe('parseDayOffset', () => {
  it('parses "7d" as 7', () => {
    expect(parseDayOffset('7d')).toBe(7);
  });

  it('parses "30d" as 30', () => {
    expect(parseDayOffset('30d')).toBe(30);
  });

  it('is case-insensitive', () => {
    expect(parseDayOffset('7D')).toBe(7);
  });

  it('returns null for "all"', () => {
    expect(parseDayOffset('all')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDayOffset('')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseDayOffset('0d')).toBeNull();
  });

  it('returns null for a plain number with no suffix', () => {
    expect(parseDayOffset('7')).toBeNull();
  });
});
