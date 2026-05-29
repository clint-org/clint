import { describe, it, expect } from 'vitest';
import { Company } from '../../core/models/company.model';
import { computeTimelineStats } from './timeline-stats';

function makeCompany(
  name: string,
  assets: { trials: { phase_type?: string; markers?: { event_date: string }[] }[] }[]
): Company {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    space_id: 'sp', created_by: 'u', name, logo_url: null, display_order: 0,
    created_at: '', updated_at: '', updated_by: null,
    assets: assets.map((a, i) => ({
      id: `a${i}`, space_id: 'sp', created_by: 'u', company_id: '',
      name: `Asset ${i}`, generic_name: null, logo_url: null, display_order: 0,
      created_at: '', updated_at: '', updated_by: null,
      trials: a.trials.map((t, j) => ({
        id: `t${i}-${j}`, space_id: 'sp', created_by: 'u', asset_id: `a${i}`,
        name: `Trial ${j}`, identifier: null, status: null, notes: null,
        display_order: 0, created_at: '', updated_at: '', updated_by: null,
        phase_type: t.phase_type ?? null, phase_start_date: null, phase_end_date: null,
        markers: (t.markers ?? []).map((m, k) => ({
          id: `m${k}`, space_id: 'sp', marker_type_id: '', title: '',
          projection: 'projected' as const, event_date: m.event_date, end_date: null,
          is_projected: true, no_longer_expected: false, marker_assignments: [],
        })),
        recent_changes_count: 0, most_recent_change_type: null,
      })),
    })),
  };
}

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
