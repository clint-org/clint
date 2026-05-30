import { describe, it, expect } from 'vitest';

import { badgeTooltip, badgeTypeLabel } from './change-badge.logic';

describe('badgeTypeLabel', () => {
  it('returns null for a null type', () => {
    expect(badgeTypeLabel(null)).toBeNull();
  });
  it('maps a known type to its label', () => {
    expect(badgeTypeLabel('date_moved')).toBe('Date moved');
  });
  it('maps intelligence_published to "New intelligence"', () => {
    expect(badgeTypeLabel('intelligence_published')).toBe('New intelligence');
  });
  it('humanizes an unknown type by replacing underscores', () => {
    expect(badgeTypeLabel('some_new_thing')).toBe('some new thing');
  });
});

describe('badgeTooltip', () => {
  it('is empty when count is zero', () => {
    expect(badgeTooltip(0, 'date_moved')).toBe('');
  });
  it('shows the type label for a single change', () => {
    expect(badgeTooltip(1, 'date_moved')).toBe('Recent change: Date moved');
  });
  it('falls back to a generic head when type is null', () => {
    expect(badgeTooltip(1, null)).toBe('Recent change');
  });
  it('counts one additional change (singular)', () => {
    expect(badgeTooltip(2, 'date_moved')).toBe('Recent change: Date moved (+1 other change)');
  });
  it('counts multiple additional changes (plural)', () => {
    expect(badgeTooltip(3, 'status_changed')).toBe('Recent change: Status changed (+2 other changes)');
  });
});
