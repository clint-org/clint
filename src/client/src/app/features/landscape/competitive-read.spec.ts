import { describe, it, expect } from 'vitest';
import { Company } from '../../core/models/company.model';
import { buildCompetitiveRead, computeTimelineStats } from './competitive-read';

function makeCompany(
  name: string,
  assets: {
    trials: {
      phase_type?: string;
      recent_changes_count?: number;
      markers?: { event_date: string }[];
    }[];
  }[]
): Company {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    space_id: 'sp',
    created_by: 'u',
    name,
    logo_url: null,
    display_order: 0,
    created_at: '',
    updated_at: '',
    updated_by: null,
    assets: assets.map((a, i) => ({
      id: `a${i}`,
      space_id: 'sp',
      created_by: 'u',
      company_id: '',
      name: `Asset ${i}`,
      generic_name: null,
      logo_url: null,
      display_order: 0,
      created_at: '',
      updated_at: '',
      updated_by: null,
      trials: a.trials.map((t, j) => ({
        id: `t${i}-${j}`,
        space_id: 'sp',
        created_by: 'u',
        asset_id: `a${i}`,
        name: `Trial ${j}`,
        identifier: null,
        status: null,
        notes: null,
        display_order: 0,
        created_at: '',
        updated_at: '',
        updated_by: null,
        phase_type: t.phase_type ?? null,
        phase_start_date: null,
        phase_end_date: null,
        markers: (t.markers ?? []).map((m, k) => ({
          id: `m${k}`,
          space_id: 'sp',
          marker_type_id: '',
          title: '',
          projection: 'projected' as const,
          event_date: m.event_date,
          end_date: null,
          is_projected: true,
          no_longer_expected: false,
          marker_assignments: [],
        })),
        recent_changes_count: t.recent_changes_count ?? 0,
        most_recent_change_type: null,
      })),
    })),
  };
}

describe('buildCompetitiveRead', () => {
  it('returns empty for 0 companies', () => {
    const result = buildCompetitiveRead([]);
    expect(result.segments).toHaveLength(0);
    expect(result.text).toBe('');
  });

  it('returns sole entrant for 1 company', () => {
    const co = makeCompany('Pfizer', [{ trials: [{ phase_type: 'P3' }, { phase_type: 'P2' }] }]);
    const result = buildCompetitiveRead([co]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].kind).toBe('sole');
    expect(result.text).toContain('Pfizer');
    expect(result.text).toContain('1 asset');
    expect(result.text).toContain('2 trials');
  });

  it('identifies a clear leader with P3 count', () => {
    const coA = makeCompany('Lilly', [
      { trials: [{ phase_type: 'P3' }, { phase_type: 'P3' }, { phase_type: 'P3' }] },
      { trials: [{ phase_type: 'P2' }] },
    ]);
    const coB = makeCompany('Amgen', [{ trials: [{ phase_type: 'P1' }] }]);
    const result = buildCompetitiveRead([coA, coB]);
    expect(result.segments[0].kind).toBe('leader');
    expect(result.segments[0].companyName).toBe('Lilly');
    expect(result.text).toContain('Lilly');
    expect(result.text).toContain('3 at P3');
  });

  it('shows leader + deepest + most active', () => {
    const leader = makeCompany('Lilly', [
      { trials: [{ phase_type: 'P3' }, { phase_type: 'P3' }] },
      { trials: [{ phase_type: 'P3' }] },
    ]);
    const deep = makeCompany('Novo', [{ trials: [{ phase_type: 'P3' }, { phase_type: 'P3' }] }]);
    const active = makeCompany('AZ', [{ trials: [{ phase_type: 'P1', recent_changes_count: 5 }] }]);
    const result = buildCompetitiveRead([leader, deep, active]);
    expect(result.segments).toHaveLength(3);
    expect(result.segments.map((s) => s.kind)).toEqual(['leader', 'deepest', 'most-active']);
    expect(result.segments[1].companyName).toBe('Novo');
    expect(result.segments[2].companyName).toBe('AZ');
  });

  it('suppresses most-active when < 2 recent changes', () => {
    const leader = makeCompany('Lilly', [{ trials: [{ phase_type: 'P3' }] }]);
    const other = makeCompany('Amgen', [
      { trials: [{ phase_type: 'P1', recent_changes_count: 1 }] },
    ]);
    const result = buildCompetitiveRead([leader, other]);
    expect(result.segments.find((s) => s.kind === 'most-active')).toBeUndefined();
  });

  it('suppresses most-active when same company as deepest', () => {
    const leader = makeCompany('Lilly', [{ trials: [{ phase_type: 'P3' }, { phase_type: 'P3' }] }]);
    const both = makeCompany('Novo', [{ trials: [{ phase_type: 'P3', recent_changes_count: 5 }] }]);
    const result = buildCompetitiveRead([leader, both]);
    expect(result.segments.find((s) => s.kind === 'deepest')).toBeTruthy();
    expect(result.segments.find((s) => s.kind === 'most-active')).toBeUndefined();
  });

  it('escapes HTML in company names', () => {
    const co = makeCompany('<Bio & Tech>', [{ trials: [{ phase_type: 'P3' }] }]);
    const result = buildCompetitiveRead([co]);
    expect(result.text).toContain('&lt;Bio &amp; Tech&gt;');
    expect(result.text).not.toContain('<Bio');
  });

  it('falls back to highest phase label when no P3 trials', () => {
    const coA = makeCompany('Lilly', [
      { trials: [{ phase_type: 'P2' }] },
      { trials: [{ phase_type: 'P2' }] },
    ]);
    const coB = makeCompany('Amgen', [{ trials: [{ phase_type: 'P1' }] }]);
    const result = buildCompetitiveRead([coA, coB]);
    expect(result.text).toContain('furthest at Phase 2');
  });
});

describe('computeTimelineStats', () => {
  it('returns zeros for empty input', () => {
    const result = computeTimelineStats([], '2026-01-01');
    expect(result).toEqual({ companyCount: 0, assetCount: 0, trialCount: 0, catalystCount90d: 0 });
  });

  it('counts companies, assets, trials', () => {
    const companies = [
      makeCompany('A', [
        { trials: [{ phase_type: 'P1' }, { phase_type: 'P2' }] },
        { trials: [{ phase_type: 'P3' }] },
      ]),
      makeCompany('B', [{ trials: [{ phase_type: 'P1' }] }]),
    ];
    const result = computeTimelineStats(companies, '2026-01-01');
    expect(result.companyCount).toBe(2);
    expect(result.assetCount).toBe(3);
    expect(result.trialCount).toBe(4);
  });

  it('counts catalysts within 90-day window', () => {
    const co = makeCompany('A', [
      {
        trials: [
          {
            phase_type: 'P3',
            markers: [
              { event_date: '2025-12-31' },
              { event_date: '2026-01-01' },
              { event_date: '2026-03-31' },
              { event_date: '2026-04-01' },
              { event_date: '2026-04-02' },
            ],
          },
        ],
      },
    ]);
    const result = computeTimelineStats([co], '2026-01-01');
    expect(result.catalystCount90d).toBe(3);
  });
});
