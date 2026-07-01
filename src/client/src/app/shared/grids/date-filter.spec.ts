import { describe, expect, it } from 'vitest';

import {
  normalizeDateFilterValue,
  toDatePickerRange,
  toLocalIsoDate,
  parseLocalIsoDate,
} from './date-filter';

describe('toLocalIsoDate', () => {
  it('formats a local date without a timezone day-shift', () => {
    // Local midnight on the 1st must stay the 1st regardless of the runner TZ.
    expect(toLocalIsoDate(new Date(2026, 1, 1))).toBe('2026-02-01');
    expect(toLocalIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('parseLocalIsoDate', () => {
  it('parses YYYY-MM-DD into a local date (round-trips with toLocalIsoDate)', () => {
    const d = parseLocalIsoDate('2026-02-09');
    expect(d).not.toBeNull();
    expect(toLocalIsoDate(d!)).toBe('2026-02-09');
  });

  it('returns null for garbage', () => {
    expect(parseLocalIsoDate('not-a-date')).toBeNull();
  });
});

describe('normalizeDateFilterValue', () => {
  it('formats a [Date, Date] range picker value to from/to strings', () => {
    const v = normalizeDateFilterValue([new Date(2026, 1, 1), new Date(2026, 1, 28)]);
    expect(v).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('passes through already-serialized strings', () => {
    expect(normalizeDateFilterValue(['2026-02-01', '2026-02-28'])).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('keeps a one-sided range (start only)', () => {
    expect(normalizeDateFilterValue([new Date(2026, 1, 1), null])).toEqual({
      from: '2026-02-01',
      to: null,
    });
  });

  it('returns null when both ends are empty or the value is not an array', () => {
    expect(normalizeDateFilterValue([null, null])).toBeNull();
    expect(normalizeDateFilterValue(null)).toBeNull();
    expect(normalizeDateFilterValue('2026-02-01')).toBeNull();
  });
});

describe('toDatePickerRange', () => {
  it('turns stored strings into Date objects for the picker', () => {
    const out = toDatePickerRange(['2026-02-01', '2026-02-28']);
    expect(out).not.toBeNull();
    expect(out!.map(toLocalIsoDate)).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('returns null when nothing is set', () => {
    expect(toDatePickerRange(null)).toBeNull();
    expect(toDatePickerRange([null, null])).toBeNull();
  });
});
