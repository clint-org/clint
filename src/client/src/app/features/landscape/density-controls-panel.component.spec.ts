import { signal, computed } from '@angular/core';
import { describe, expect, it } from 'vitest';

import type {
  CountUnit,
  DensityBubble,
  DensityGrouping,
  RingPhase,
} from '../../core/models/landscape.model';

function makeBubble(overrides: Partial<DensityBubble> = {}): DensityBubble {
  return {
    label: 'Test MOA',
    group_keys: {},
    competitor_count: 3,
    highest_phase: 'P3',
    highest_phase_rank: 3,
    unit_count: 10,
    phase_counts: {},
    products: [],
    ...overrides,
  };
}

function formatPhase(phase: RingPhase): string {
  const labels: Record<RingPhase, string> = {
    PRECLIN: 'Preclinical',
    P1: 'Phase 1',
    P2: 'Phase 2',
    P3: 'Phase 3',
    P4: 'Phase 4',
    APPROVED: 'Approved',
    LAUNCHED: 'Launched',
  };
  return labels[phase];
}

function escapeName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildReadText(list: DensityBubble[], unit: CountUnit): string {
  if (list.length < 2) return '';

  const parts: string[] = [];

  const mostCrowded = list.reduce((best, b) => (b.unit_count > best.unit_count ? b : best));
  parts.push(
    `<strong class="leader-name">${escapeName(mostCrowded.label)}</strong> most crowded (${mostCrowded.unit_count} ${unit})`
  );

  const sparseCandidate = list
    .filter((b) => b.unit_count > 0 && b.highest_phase_rank >= 2)
    .sort((a, b) => a.unit_count - b.unit_count)[0];

  if (sparseCandidate) {
    parts.push(
      `<strong>${escapeName(sparseCandidate.label)}</strong> sparse at ${formatPhase(sparseCandidate.highest_phase)}`
    );
  }

  return parts.join(' | ');
}

function buildComputeds(
  initialBubbles: DensityBubble[] = [],
  initialGrouping: DensityGrouping = 'moa',
  initialCountUnit: CountUnit = 'assets'
) {
  const bubbles = signal<DensityBubble[]>(initialBubbles);
  const grouping = signal<DensityGrouping>(initialGrouping);
  const countUnit = signal<CountUnit>(initialCountUnit);

  const groupCount = computed(() => bubbles().length);
  const totalCount = computed(() => bubbles().reduce((sum, b) => sum + b.unit_count, 0));
  const readText = computed<string>(() => buildReadText(bubbles(), countUnit()));

  return { bubbles, grouping, countUnit, groupCount, totalCount, readText };
}

describe('DensityControlsPanelComponent GROUP BY', () => {
  it('active button matches the grouping input', () => {
    const { grouping } = buildComputeds([], 'indication');
    expect(grouping()).toBe('indication');
  });

  it('reflects grouping changes', () => {
    const { grouping } = buildComputeds([], 'moa');
    expect(grouping()).toBe('moa');
    grouping.set('company');
    expect(grouping()).toBe('company');
  });
});

describe('DensityControlsPanelComponent COUNT', () => {
  it('active button matches the countUnit input', () => {
    const { countUnit } = buildComputeds([], 'moa', 'trials');
    expect(countUnit()).toBe('trials');
  });

  it('updating countUnit signal reflects in the computed label', () => {
    const { countUnit } = buildComputeds([], 'moa', 'assets');
    expect(countUnit()).toBe('assets');
    countUnit.set('companies');
    expect(countUnit()).toBe('companies');
  });
});

describe('DensityControlsPanelComponent READ', () => {
  it('returns empty string when fewer than 2 bubbles', () => {
    const { readText } = buildComputeds([makeBubble()]);
    expect(readText()).toBe('');
  });

  it('returns empty string for zero bubbles', () => {
    const { readText } = buildComputeds([]);
    expect(readText()).toBe('');
  });

  it('generates crowded + sparse text with mock bubbles', () => {
    const bubbles = [
      makeBubble({
        label: 'PD-1/PD-L1',
        unit_count: 31,
        highest_phase_rank: 6,
        highest_phase: 'LAUNCHED',
      }),
      makeBubble({ label: 'KRAS G12C', unit_count: 4, highest_phase_rank: 3, highest_phase: 'P3' }),
      makeBubble({
        label: 'VEGF',
        unit_count: 19,
        highest_phase_rank: 5,
        highest_phase: 'APPROVED',
      }),
    ];
    const { readText } = buildComputeds(bubbles);
    const text = readText();

    expect(text).toContain('PD-1/PD-L1');
    expect(text).toContain('most crowded');
    expect(text).toContain('31 assets');
    expect(text).toContain('KRAS G12C');
    expect(text).toContain('sparse at Phase 3');
  });

  it('identifies the sparse opportunity as lowest non-zero unit_count with rank >= 2', () => {
    const bubbles = [
      makeBubble({
        label: 'Big MOA',
        unit_count: 20,
        highest_phase_rank: 5,
        highest_phase: 'APPROVED',
      }),
      makeBubble({ label: 'Early MOA', unit_count: 1, highest_phase_rank: 1, highest_phase: 'P1' }),
      makeBubble({ label: 'Mid MOA', unit_count: 3, highest_phase_rank: 2, highest_phase: 'P2' }),
    ];
    const { readText } = buildComputeds(bubbles);
    const text = readText();

    expect(text).toContain('Mid MOA');
    expect(text).toContain('sparse at Phase 2');
    expect(text).not.toContain('Early MOA');
  });

  it('omits sparse section when no bubble qualifies (all rank < 2)', () => {
    const bubbles = [
      makeBubble({ label: 'A', unit_count: 10, highest_phase_rank: 0, highest_phase: 'PRECLIN' }),
      makeBubble({ label: 'B', unit_count: 5, highest_phase_rank: 1, highest_phase: 'P1' }),
    ];
    const { readText } = buildComputeds(bubbles);
    const text = readText();

    expect(text).toContain('A');
    expect(text).toContain('most crowded');
    expect(text).not.toContain('sparse');
    expect(text).not.toContain('|');
  });

  it('uses the current countUnit label in the crowded text', () => {
    const bubbles = [
      makeBubble({ label: 'A', unit_count: 10, highest_phase_rank: 3 }),
      makeBubble({ label: 'B', unit_count: 5, highest_phase_rank: 3 }),
    ];
    const { readText, countUnit } = buildComputeds(bubbles, 'moa', 'trials');
    expect(readText()).toContain('10 trials');

    countUnit.set('companies');
    expect(readText()).toContain('10 companies');
  });

  it('escapes HTML in bubble names', () => {
    const bubbles = [
      makeBubble({ label: '<Bio & Tech>', unit_count: 20, highest_phase_rank: 3 }),
      makeBubble({ label: 'Normal', unit_count: 5, highest_phase_rank: 3 }),
    ];
    const { readText } = buildComputeds(bubbles);
    const text = readText();

    expect(text).toContain('&lt;Bio &amp; Tech&gt;');
    expect(text).not.toContain('<Bio');
  });
});

describe('DensityControlsPanelComponent STATS', () => {
  it('group count matches bubbles.length', () => {
    const bubbles = [makeBubble(), makeBubble(), makeBubble()];
    const { groupCount } = buildComputeds(bubbles);
    expect(groupCount()).toBe(3);
  });

  it('returns zero group count for empty bubbles', () => {
    const { groupCount } = buildComputeds([]);
    expect(groupCount()).toBe(0);
  });

  it('total count sums unit_count values', () => {
    const bubbles = [
      makeBubble({ unit_count: 10 }),
      makeBubble({ unit_count: 25 }),
      makeBubble({ unit_count: 7 }),
    ];
    const { totalCount } = buildComputeds(bubbles);
    expect(totalCount()).toBe(42);
  });

  it('total count returns zero for empty bubbles', () => {
    const { totalCount } = buildComputeds([]);
    expect(totalCount()).toBe(0);
  });

  it('stats label changes with countUnit', () => {
    const { countUnit } = buildComputeds([], 'moa', 'assets');
    expect(countUnit()).toBe('assets');
    countUnit.set('trials');
    expect(countUnit()).toBe('trials');
    countUnit.set('companies');
    expect(countUnit()).toBe('companies');
  });

  it('updates group count reactively when bubbles change', () => {
    const { bubbles, groupCount, totalCount } = buildComputeds([makeBubble({ unit_count: 5 })]);
    expect(groupCount()).toBe(1);
    expect(totalCount()).toBe(5);

    bubbles.set([makeBubble({ unit_count: 5 }), makeBubble({ unit_count: 15 })]);
    expect(groupCount()).toBe(2);
    expect(totalCount()).toBe(20);
  });
});
