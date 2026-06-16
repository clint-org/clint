import { describe, expect, it } from 'vitest';
import { viewDetailsLabel } from './accessible-row-label';

describe('viewDetailsLabel (P2.5)', () => {
  it('uses the visible title when present', () => {
    expect(viewDetailsLabel('Topline Phase 3 readout')).toBe(
      'View details for Topline Phase 3 readout',
    );
  });

  it('never emits "null" when the title is null (detected-row bug)', () => {
    expect(viewDetailsLabel(null)).toBe('View details for this event');
  });

  it('falls back for undefined', () => {
    expect(viewDetailsLabel(undefined)).toBe('View details for this event');
  });

  it('falls back for empty or whitespace-only titles', () => {
    expect(viewDetailsLabel('')).toBe('View details for this event');
    expect(viewDetailsLabel('   ')).toBe('View details for this event');
  });
});
