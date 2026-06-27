import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { PrimaryIntelligenceBrief } from '../../../core/models/primary-intelligence.model';
import { computeReorder, leadFirst } from './reorder';

function brief(id: string, is_lead = false, display_order = 0): PrimaryIntelligenceBrief {
  return {
    anchor_id: id,
    is_lead,
    display_order,
    published: null,
    draft: null,
    updated_at: null,
    version_count: 0,
  };
}

describe('leadFirst', () => {
  it('moves the is_lead brief to the front, preserving the rest order', () => {
    const out = leadFirst([brief('a'), brief('b', true), brief('c')]);
    expect(out.map((b) => b.anchor_id)).toEqual(['b', 'a', 'c']);
  });

  it('returns the input order when no brief is flagged lead', () => {
    const out = leadFirst([brief('a'), brief('b'), brief('c')]);
    expect(out.map((b) => b.anchor_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('computeReorder', () => {
  const ordered = [brief('lead', true), brief('x'), brief('y'), brief('z')];

  it('emits the FULL anchor set including the lead (regression: reorder bug)', () => {
    const ids = computeReorder(ordered, 2, 1); // move y above x
    expect(ids).toHaveLength(ordered.length);
    expect(new Set(ids)).toEqual(new Set(['lead', 'x', 'y', 'z']));
  });

  it('keeps the lead at index 0 and reorders the others', () => {
    const ids = computeReorder(ordered, 3, 1); // move z to position 1
    expect(ids[0]).toBe('lead');
    expect(ids).toEqual(['lead', 'z', 'x', 'y']);
  });

  it('never lets a non-lead land above the lead (drop into index 0 is clamped)', () => {
    const ids = computeReorder(ordered, 2, 0); // try to drop y at the very top
    expect(ids[0]).toBe('lead');
  });
});
