import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVENT_TYPE_SIGNIFICANCE,
  EVENT_TYPE_SIGNIFICANCE_OPTIONS,
} from './event-type-form.significance';

// QA-011: the form once offered a "None" (null) option that defaulted to null,
// which violated the NOT NULL `default_significance` column and surfaced a raw
// Postgres 23502 error on create. These tests pin the column's invariant so the
// null option cannot be reintroduced.
describe('event-type significance options', () => {
  it('offers exactly the two values the column allows (high, low)', () => {
    expect(EVENT_TYPE_SIGNIFICANCE_OPTIONS.map((o) => o.value)).toEqual(['high', 'low']);
  });

  it('never offers a null/"None" choice (the NOT NULL constraint forbids it)', () => {
    for (const option of EVENT_TYPE_SIGNIFICANCE_OPTIONS) {
      expect(option.value).not.toBeNull();
      expect(option.value).toBeTypeOf('string');
    }
  });

  it('defaults to a non-null value that is one of the offered options', () => {
    expect(DEFAULT_EVENT_TYPE_SIGNIFICANCE).not.toBeNull();
    expect(EVENT_TYPE_SIGNIFICANCE_OPTIONS.map((o) => o.value)).toContain(
      DEFAULT_EVENT_TYPE_SIGNIFICANCE
    );
  });

  it('defaults to the column default (high) for new custom types', () => {
    expect(DEFAULT_EVENT_TYPE_SIGNIFICANCE).toBe('high');
  });
});
