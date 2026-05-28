import { describe, expect, it } from 'vitest';
import { isEventFormComplete } from './event-form-validity';

describe('isEventFormComplete', () => {
  const date = new Date('2026-05-06T00:00:00');

  it('is true when title, date, and category are all present', () => {
    expect(isEventFormComplete('Readout', date, 'cat-1')).toBe(true);
  });

  it('is false when the title is empty or whitespace-only', () => {
    expect(isEventFormComplete('', date, 'cat-1')).toBe(false);
    expect(isEventFormComplete('   ', date, 'cat-1')).toBe(false);
  });

  it('is false when the date is missing', () => {
    expect(isEventFormComplete('Readout', null, 'cat-1')).toBe(false);
  });

  it('is false when the category is empty or whitespace-only', () => {
    expect(isEventFormComplete('Readout', date, '')).toBe(false);
    expect(isEventFormComplete('Readout', date, '   ')).toBe(false);
  });
});
