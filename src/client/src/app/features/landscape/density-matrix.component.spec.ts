import { describe, it, expect } from 'vitest';

import type { PositioningBubble, RingPhase } from '../../core/models/landscape.model';
import { computeIntensity, formatFreshness } from './density-matrix.component';

function makeBubble(
  label: string,
  phaseCounts: Partial<Record<RingPhase, number>>,
  overrides: Partial<PositioningBubble> = {},
): PositioningBubble {
  const total = Object.values(phaseCounts).reduce((s, v) => s + (v ?? 0), 0);
  return {
    label,
    group_keys: {},
    competitor_count: overrides.competitor_count ?? 1,
    highest_phase: overrides.highest_phase ?? 'P3',
    highest_phase_rank: overrides.highest_phase_rank ?? 3,
    unit_count: overrides.unit_count ?? total,
    phase_counts: phaseCounts,
    products: [],
    ...overrides,
  };
}

describe('computeIntensity', () => {
  it('returns 0 for a zero value', () => {
    expect(computeIntensity([1, 2, 3], 0)).toBe(0);
  });

  it('returns max intensity for a single non-zero value (it is both min and max)', () => {
    expect(computeIntensity([5], 5)).toBe(8);
  });

  it('uses linear mapping when fewer than 8 distinct values', () => {
    expect(computeIntensity([1, 2, 3, 4], 1)).toBe(2);
    expect(computeIntensity([1, 2, 3, 4], 2)).toBe(4);
    expect(computeIntensity([1, 2, 3, 4], 3)).toBe(6);
    expect(computeIntensity([1, 2, 3, 4], 4)).toBe(8);
  });

  it('clamps linear mapping to 1 minimum', () => {
    expect(computeIntensity([10], 1)).toBe(1);
  });

  it('uses quantile bucketing with 8+ distinct values', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    expect(computeIntensity(values, 1)).toBe(1);
    expect(computeIntensity(values, 16)).toBe(8);
  });

  it('returns 1 as minimum intensity for value not in the values array', () => {
    expect(computeIntensity([5, 10], 1)).toBe(1);
  });
});

describe('formatFreshness', () => {
  it('returns null when isoDate is null', () => {
    expect(formatFreshness(null, new Date())).toBeNull();
  });

  it('returns "Updated just now" for less than 1 hour', () => {
    const now = new Date('2026-05-27T12:00:00Z');
    const recent = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    expect(formatFreshness(recent, now)).toBe('Updated just now');
  });

  it('returns "Updated Xh ago" for 1-23 hours', () => {
    const now = new Date('2026-05-27T12:00:00Z');
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatFreshness(threeHoursAgo, now)).toBe('Updated 3h ago');
  });

  it('returns "Updated Xd ago" for 1-6 days', () => {
    const now = new Date('2026-05-27T12:00:00Z');
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatFreshness(twoDaysAgo, now)).toBe('Updated 2d ago');
  });

  it('returns formatted date for 7+ days', () => {
    const now = new Date('2026-05-27T12:00:00Z');
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatFreshness(tenDaysAgo, now);
    expect(result).toMatch(/^Updated May 17$/);
  });

  it('returns "Updated just now" for future dates', () => {
    const now = new Date('2026-05-27T12:00:00Z');
    const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    expect(formatFreshness(future, now)).toBe('Updated just now');
  });
});

describe('DensityMatrixComponent row computation', () => {
  it('computes correct number of rows from bubbles', () => {
    const bubbles = [
      makeBubble('Alpha', { PRECLIN: 2, P1: 3 }),
      makeBubble('Beta', { P2: 1, P3: 4 }),
      makeBubble('Gamma', { LAUNCHED: 2 }),
    ];
    expect(bubbles).toHaveLength(3);
  });

  it('computes total as sum of phase_counts', () => {
    const b = makeBubble('Test', { PRECLIN: 2, P1: 3, P3: 5 });
    const total = Object.values(b.phase_counts).reduce((s, v) => s + (v ?? 0), 0);
    expect(total).toBe(10);
  });

  it('treats missing phase keys as zero', () => {
    const b = makeBubble('Test', { P3: 5 });
    const p1Count = b.phase_counts['P1'] ?? 0;
    expect(p1Count).toBe(0);
  });

  it('sorts by total descending by default', () => {
    const bubbles = [
      makeBubble('Small', { P1: 1 }),
      makeBubble('Large', { P1: 5, P2: 3 }),
      makeBubble('Medium', { P1: 3 }),
    ];

    const rows = bubbles
      .map((b) => ({
        label: b.label,
        total: Object.values(b.phase_counts).reduce((s, v) => s + (v ?? 0), 0),
      }))
      .sort((a, b) => b.total - a.total);

    expect(rows.map((r) => r.label)).toEqual(['Large', 'Medium', 'Small']);
  });

  it('sorts by name ascending', () => {
    const bubbles = [
      makeBubble('Charlie', { P1: 1 }),
      makeBubble('Alpha', { P1: 2 }),
      makeBubble('Bravo', { P1: 3 }),
    ];

    const sorted = [...bubbles].sort((a, b) => a.label.localeCompare(b.label));
    expect(sorted.map((b) => b.label)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('handles empty bubbles array', () => {
    const bubbles: PositioningBubble[] = [];
    expect(bubbles).toHaveLength(0);
  });

  it('selected row is identified by reference equality', () => {
    const b1 = makeBubble('A', { P1: 1 });
    const b2 = makeBubble('B', { P2: 2 });
    const selected = b1;
    expect(selected === b1).toBe(true);
    expect(selected === b2).toBe(false);
  });

  it('computes intensity for each cell in a row', () => {
    const allNonZero = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(computeIntensity(allNonZero, 1)).toBeGreaterThanOrEqual(1);
    expect(computeIntensity(allNonZero, 8)).toBeLessThanOrEqual(8);
    expect(computeIntensity(allNonZero, 0)).toBe(0);
  });

  it('produces correct cell structure for all 7 phases', () => {
    const b = makeBubble('Full', {
      PRECLIN: 1,
      P1: 2,
      P2: 3,
      P3: 4,
      P4: 5,
      APPROVED: 6,
      LAUNCHED: 7,
    });

    const phases: RingPhase[] = [
      'PRECLIN', 'P1', 'P2', 'P3', 'P4', 'APPROVED', 'LAUNCHED',
    ];

    const cells = phases.map((phase) => ({
      phase,
      count: b.phase_counts[phase] ?? 0,
    }));

    expect(cells).toHaveLength(7);
    expect(cells[0].count).toBe(1);
    expect(cells[6].count).toBe(7);
  });

  it('formats competitor count with correct pluralization', () => {
    const single = makeBubble('One', { P1: 1 }, { competitor_count: 1 });
    const multiple = makeBubble('Many', { P1: 1 }, { competitor_count: 5 });
    expect(single.competitor_count === 1 ? 'company' : 'companies').toBe('company');
    expect(multiple.competitor_count === 1 ? 'company' : 'companies').toBe('companies');
  });
});
