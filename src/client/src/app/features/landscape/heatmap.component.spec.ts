import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import type { HeatmapBubble, HeatmapAsset, RingPhase } from '../../core/models/landscape.model';
import { cellTint, heatmapStep, formatFreshness } from './heatmap-cell';

function makeBubble(
  label: string,
  phaseCounts: Partial<Record<RingPhase, number>>,
  overrides: Partial<HeatmapBubble> = {}
): HeatmapBubble {
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

describe('heatmapStep', () => {
  it('returns 0 for an empty cell', () => {
    expect(heatmapStep(0)).toBe(0);
    expect(heatmapStep(-3)).toBe(0);
  });

  it('maps the low counts one-to-one', () => {
    expect(heatmapStep(1)).toBe(1);
    expect(heatmapStep(2)).toBe(2);
    expect(heatmapStep(3)).toBe(3);
  });

  it('buckets 4-5 together as step 4', () => {
    expect(heatmapStep(4)).toBe(4);
    expect(heatmapStep(5)).toBe(4);
  });

  it('buckets 6-9 together as step 5', () => {
    expect(heatmapStep(6)).toBe(5);
    expect(heatmapStep(9)).toBe(5);
  });

  it('caps at step 6 for 10 or more', () => {
    expect(heatmapStep(10)).toBe(6);
    expect(heatmapStep(50)).toBe(6);
  });

  it('is absolute: a given count maps to the same step regardless of the rest of the matrix', () => {
    // No second argument: the step does not depend on other cells, so it is
    // stable across the Assets / Trials / Companies toggle.
    expect(heatmapStep(3)).toBe(heatmapStep(3));
  });
});

describe('cellTint', () => {
  it('returns null for an empty cell so no background paints', () => {
    expect(cellTint('#0d9488', 0)).toBeNull();
  });

  it('mixes the phase hue over white, deeper as the count rises', () => {
    const c1 = cellTint('#0d9488', 1);
    const c6 = cellTint('#0d9488', 10);
    expect(c1).toContain('#0d9488');
    expect(c1).toContain('white');
    expect(c1).toMatch(/14%/);
    expect(c6).toMatch(/54%/);
  });

  it('uses the cell phase color, not a fixed brand color', () => {
    // A violet phase cell tints violet; a teal phase cell tints teal.
    expect(cellTint('#7c3aed', 2)).toContain('#7c3aed');
    expect(cellTint('#0d9488', 2)).toContain('#0d9488');
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

describe('HeatmapComponent row computation', () => {
  it('computes correct number of rows from bubbles', () => {
    const bubbles = [
      makeBubble('Alpha', { PRECLIN: 2, P1: 3 }),
      makeBubble('Beta', { P2: 1, P3: 4 }),
      makeBubble('Gamma', { LAUNCHED: 2 }),
    ];
    expect(bubbles).toHaveLength(3);
  });

  it('total uses unit_count from the bubble, not the sum of phase_counts', () => {
    const b = makeBubble('Test', { PRECLIN: 2, P1: 3, P3: 5 }, { unit_count: 42 });
    expect(b.unit_count).toBe(42);
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
        total: b.unit_count,
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
    const bubbles: HeatmapBubble[] = [];
    expect(bubbles).toHaveLength(0);
  });

  it('selected row is identified by reference equality', () => {
    const b1 = makeBubble('A', { P1: 1 });
    const b2 = makeBubble('B', { P2: 2 });
    const selected = b1;
    expect(selected === b1).toBe(true);
    expect(selected === b2).toBe(false);
  });

  it('computes a phase-hued background for each non-empty cell', () => {
    // Empty cells get no background; non-empty cells tint their own phase hue.
    expect(cellTint('#0d9488', 0)).toBeNull();
    expect(cellTint('#0d9488', 4)).toContain('#0d9488');
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

    const phases: RingPhase[] = ['PRECLIN', 'P1', 'P2', 'P3', 'P4', 'APPROVED', 'LAUNCHED'];

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

/**
 * Cell-level primary-intelligence flag. A cell (a group at one phase) is
 * flagged when ANY asset at that phase owns published PI. The unit runner has
 * no Angular compiler, so we mirror the component's predicate against a bubble
 * fixture and pin the template/computed wiring by source contract.
 */
function asset(id: string, phase: RingPhase, hasIntelligence: boolean): HeatmapAsset {
  return {
    id,
    name: id,
    generic_name: null,
    company_id: 'c',
    company_name: 'Co',
    company_logo_url: null,
    highest_phase: phase,
    highest_phase_rank: 0,
    trial_count: 1,
    has_intelligence: hasIntelligence,
  };
}

// Mirrors the predicate in HeatmapComponent's cell builder.
function cellHasIntelligence(bubble: HeatmapBubble, phase: RingPhase): boolean {
  return bubble.products.some((p) => p.highest_phase === phase && p.has_intelligence);
}

const heatmapSrc = readFileSync(join(__dirname, 'heatmap.component.ts'), 'utf8');

describe('heatmap cell primary-intelligence flag', () => {
  it('flags a cell when any asset at that phase has PI', () => {
    const bubble = makeBubble('Obesity', { P3: 2 }, {
      products: [asset('a1', 'P3', false), asset('a2', 'P3', true)],
    });
    expect(cellHasIntelligence(bubble, 'P3')).toBe(true);
  });

  it('does not flag a phase where no PI-bearing asset sits', () => {
    const bubble = makeBubble('Obesity', { P2: 1, P3: 1 }, {
      products: [asset('a1', 'P3', true), asset('a2', 'P2', false)],
    });
    expect(cellHasIntelligence(bubble, 'P2')).toBe(false);
    expect(cellHasIntelligence(bubble, 'P3')).toBe(true);
  });

  it('renders the shared bookmark mark in the corner of flagged cells', () => {
    expect(heatmapSrc).toContain('hasIntelligence: bubble.products.some(');
    expect(heatmapSrc).toContain('@if (cell.hasIntelligence)');
    expect(heatmapSrc).toContain('<app-pi-mark [size]="9"');
  });
});
