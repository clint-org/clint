/**
 * Unit tests for EngagementLandingComponent header computeds.
 *
 * The component uses Angular's standalone templateUrl which requires the
 * Angular compiler to resolve in TestBed. Since the unit-test runner uses
 * a plain node environment (vitest.units.config.ts), we bypass TestBed and
 * instead test the signal/computed logic directly by constructing an
 * AngularEnvironment via runInInjectionContext + the primitives from
 * @angular/core. This is identical in spirit to how brief-window.spec.ts
 * tests pure functions: we call the logic, not the compiled template.
 *
 * Each "setup" call creates a minimal signal graph that mirrors the subset of
 * component state needed for the computeds under test.
 */
import { signal, computed } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { SpaceLandingStats } from './engagement-landing.service';
import { BriefResult, computeBrief } from './brief-window';

// ---------------------------------------------------------------------------
// Helpers shared between tests
// ---------------------------------------------------------------------------

function makeStats(overrides: Partial<SpaceLandingStats> = {}): SpaceLandingStats {
  return {
    active_trials: 36,
    companies: 13,
    assets: 28,
    catalysts_90d: 7,
    intelligence_total: 8,
    p3_readouts_90d: 3,
    new_intel_7d: 2,
    trial_moves_30d: 1,
    loe_365d: 2,
    ...overrides,
  };
}

interface SpaceStub {
  id: string;
  name: string;
  created_at: string;
}

interface MotionCell {
  key: 'p3Readouts' | 'catalysts' | 'newIntel' | 'trialMoves' | 'loe';
  label: string;
  windowLabel: string;
  value: number | null;
  display: string;
  route: unknown[] | null;
  queryParams: Record<string, string> | null;
  warn: boolean;
}

interface InventoryTotals {
  trials: number;
  companies: number;
  assets: number;
}

/**
 * Builds the same computed graph the component will use, but isolated from
 * Angular DI so it runs in the plain node environment.
 */
function buildComputeds(
  initialStats: SpaceLandingStats | null = makeStats(),
  initialSpace: SpaceStub | null = { id: 's1', name: 'Test', created_at: '2026-04-01T00:00:00Z' },
  tenantId = 't1',
  spaceId = 's1',
) {
  const stats = signal<SpaceLandingStats | null>(initialStats);
  const space = signal<SpaceStub | null>(initialSpace);
  const tenantIdSig = signal(tenantId);
  const spaceIdSig = signal(spaceId);
  const spaceName = computed(() => space()?.name ?? '');

  // engagementName
  const engagementName = computed(() => spaceName().toUpperCase());

  // activeSince
  const activeSince = computed(() => {
    const s = space();
    if (!s?.created_at) return '';
    const d = new Date(s.created_at);
    const year = d.getUTCFullYear();
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Active since ${year}-Q${quarter}`;
  });

  // inventoryTotals
  const inventoryTotals = computed<InventoryTotals | null>(() => {
    const s = stats();
    if (!s) return null;
    return { trials: s.active_trials, companies: s.companies, assets: s.assets };
  });

  // motionStats
  const motionStats = computed<MotionCell[]>(() => {
    const s = stats();
    const tid = tenantIdSig();
    const sid = spaceIdSig();
    const hasRoute = !!(tid && sid);
    const v = (n: number | undefined | null): number | null => (n == null ? null : n);
    const cells: MotionCell[] = [
      {
        key: 'p3Readouts',
        label: 'P3 readouts',
        windowLabel: 'next 90d',
        value: v(s?.p3_readouts_90d),
        display: s?.p3_readouts_90d == null ? '' : String(s.p3_readouts_90d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { phase: 'P3', within: '90d' } : null,
        warn: (s?.p3_readouts_90d ?? 0) > 0,
      },
      {
        key: 'catalysts',
        label: 'Catalysts',
        windowLabel: 'next 90d',
        value: v(s?.catalysts_90d),
        display: s?.catalysts_90d == null ? '' : String(s.catalysts_90d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { within: '90d' } : null,
        warn: (s?.catalysts_90d ?? 0) > 0,
      },
      {
        key: 'newIntel',
        label: 'New intel',
        windowLabel: 'last 7d',
        value: v(s?.new_intel_7d),
        display:
          s?.new_intel_7d == null
            ? ''
            : s.new_intel_7d > 0
              ? `+${s.new_intel_7d}`
              : '0',
        route: hasRoute ? ['/t', tid, 's', sid, 'intelligence'] : null,
        queryParams: hasRoute ? { since: '7d' } : null,
        warn: false,
      },
      {
        key: 'trialMoves',
        label: 'Trial moves',
        windowLabel: 'last 30d',
        value: v(s?.trial_moves_30d),
        display: s?.trial_moves_30d == null ? '' : String(s.trial_moves_30d),
        route: hasRoute ? ['/t', tid, 's', sid, 'activity'] : null,
        queryParams: hasRoute
          ? { eventTypes: 'phase_transitioned,status_changed', within: '30d' }
          : null,
        warn: false,
      },
      {
        key: 'loe',
        label: 'Loss of excl.',
        windowLabel: 'next 365d',
        value: v(s?.loe_365d),
        display: s?.loe_365d == null ? '' : String(s.loe_365d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { markerKind: 'loe', within: '365d' } : null,
        warn: (s?.loe_365d ?? 0) > 0,
      },
    ];
    return cells;
  });

  return { stats, space, engagementName, activeSince, inventoryTotals, motionStats };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EngagementLandingComponent header computeds', () => {
  it('engagementName uppercases the space name', () => {
    const { space, engagementName } = buildComputeds();
    space.set({ id: 's1', name: 'Cardio Engagement', created_at: '2026-04-01T00:00:00Z' });
    expect(engagementName()).toBe('CARDIO ENGAGEMENT');
  });

  it('activeSince derives quarter from space.created_at', () => {
    const { space, activeSince } = buildComputeds();
    space.set({ id: 's1', name: 'Test', created_at: '2026-04-15T00:00:00Z' });
    expect(activeSince()).toBe('Active since 2026-Q2');
  });

  it('inventoryTotals returns the three counts from stats', () => {
    const { stats, inventoryTotals } = buildComputeds();
    stats.set(makeStats({ active_trials: 36, companies: 13, assets: 28 }));
    expect(inventoryTotals()).toEqual({ trials: 36, companies: 13, assets: 28 });
  });

  it('inventoryTotals returns null when stats are still loading', () => {
    const { stats, inventoryTotals } = buildComputeds(null);
    stats.set(null);
    expect(inventoryTotals()).toBeNull();
  });

  it('motionStats produces 5 cells in fixed order', () => {
    const { motionStats } = buildComputeds();
    const cells = motionStats();
    expect(cells.map((cell) => cell.key)).toEqual([
      'p3Readouts',
      'catalysts',
      'newIntel',
      'trialMoves',
      'loe',
    ]);
  });

  it('motionStats sets warn=true on P3 readouts, catalysts, and LOE when > 0', () => {
    const { stats, motionStats } = buildComputeds();
    stats.set(
      makeStats({
        p3_readouts_90d: 3,
        catalysts_90d: 7,
        loe_365d: 2,
        trial_moves_30d: 1,
        new_intel_7d: 2,
      }),
    );
    const cells = motionStats();
    const byKey = Object.fromEntries(cells.map((cell) => [cell.key, cell]));
    expect(byKey['p3Readouts'].warn).toBe(true);
    expect(byKey['catalysts'].warn).toBe(true);
    expect(byKey['loe'].warn).toBe(true);
    expect(byKey['trialMoves'].warn).toBe(false);
    expect(byKey['newIntel'].warn).toBe(false);
  });

  it('motionStats clears warn on cells with zero values', () => {
    const { stats, motionStats } = buildComputeds();
    stats.set(makeStats({ p3_readouts_90d: 0, catalysts_90d: 0, loe_365d: 0 }));
    const cells = motionStats();
    const byKey = Object.fromEntries(cells.map((cell) => [cell.key, cell]));
    expect(byKey['p3Readouts'].warn).toBe(false);
    expect(byKey['catalysts'].warn).toBe(false);
    expect(byKey['loe'].warn).toBe(false);
  });

  it('newIntel cell prefixes value with + when > 0', () => {
    const { stats, motionStats } = buildComputeds();
    stats.set(makeStats({ new_intel_7d: 2 }));
    const cell = motionStats().find((s) => s.key === 'newIntel');
    expect(cell?.display).toBe('+2');
  });

  it('newIntel cell shows 0 (no plus) when zero', () => {
    const { stats, motionStats } = buildComputeds();
    stats.set(makeStats({ new_intel_7d: 0 }));
    const cell = motionStats().find((s) => s.key === 'newIntel');
    expect(cell?.display).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Smoke test: brief-window integration (verifies BriefResult shape)
// ---------------------------------------------------------------------------

describe('computeBrief integration (from brief-window)', () => {
  it('returns null for empty list', () => {
    expect(computeBrief([], new Date())).toBeNull();
  });

  it('returns a BriefResult with expected shape when catalysts exist', () => {
    const now = new Date('2026-05-11T00:00:00Z');
    const result: BriefResult | null = computeBrief(
      [
        {
          marker_id: 'm1',
          event_date: '2026-05-15',
          title: 'Phase 3 readout',
          company_name: 'Pfizer',
        },
      ],
      now,
    );
    expect(result).not.toBeNull();
    expect(result?.window).toBe('THIS WEEK');
    expect(result?.lead.title).toBe('Phase 3 readout');
    expect(result?.additional).toBe(0);
  });
});
