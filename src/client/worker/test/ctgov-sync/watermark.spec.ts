import { describe, it, expect } from 'vitest';
import { needsFullPull } from '../../ctgov-sync/watermark';

describe('needsFullPull', () => {
  it('returns true when CT.gov post date is newer than ours', () => {
    expect(needsFullPull('2026-04-01', '2026-03-15')).toBe(true);
  });

  it('returns false when dates are equal', () => {
    expect(needsFullPull('2026-04-01', '2026-04-01')).toBe(false);
  });

  it('returns true when we have no recorded post date', () => {
    expect(needsFullPull('2026-04-01', null)).toBe(true);
  });

  it('returns false when CT.gov post date is older (defensive)', () => {
    expect(needsFullPull('2026-03-15', '2026-04-01')).toBe(false);
  });
});
