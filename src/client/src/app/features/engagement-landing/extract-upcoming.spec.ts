import { describe, it, expect } from 'vitest';

import { extractUpcoming } from './extract-upcoming';
import { Company } from '../../core/models/company.model';

function isoOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mk(id: string, event_date: string) {
  return {
    id, space_id: 'sp', marker_type_id: '', title: id,
    projection: 'projected' as const, event_date, end_date: null,
    is_projected: true, no_longer_expected: false, marker_assignments: [],
  };
}

describe('extractUpcoming', () => {
  it('collects upcoming events at company, asset, and trial anchor levels', () => {
    // Regression (counter parity): this previously walked only trial.markers, so an
    // asset/company future event in the window was dropped while the backend stat
    // counted it.
    const co = {
      id: 'novo', space_id: 'sp', created_by: 'u', name: 'Novo', logo_url: null,
      display_order: 0, created_at: '', updated_at: '', updated_by: null,
      events: [mk('co-evt', isoOffset(10)), mk('co-far', isoOffset(400))],
      assets: [{
        id: 'a-cagri', space_id: 'sp', created_by: 'u', company_id: 'novo',
        name: 'CagriSema', generic_name: null, logo_url: null, display_order: 0,
        created_at: '', updated_at: '', updated_by: null,
        events: [mk('asset-evt', isoOffset(20))],
        trials: [{
          id: 't1', space_id: 'sp', created_by: 'u', asset_id: 'a-cagri',
          name: 'T', acronym: 'TRIAL-1', identifier: null, status: null, notes: null,
          display_order: 0, created_at: '', updated_at: '', updated_by: null,
          phase_type: 'P3', markers: [mk('trial-evt', isoOffset(30))],
          recent_changes_count: 0, most_recent_change_type: null,
        }],
      }],
    } as unknown as Company;

    const out = extractUpcoming([co], 90);
    const ids = out.map((r) => r.marker_id).sort();
    // co-far is +400d, outside the 90d window, so it is excluded.
    expect(ids).toEqual(['asset-evt', 'co-evt', 'trial-evt']);

    const companyRow = out.find((r) => r.marker_id === 'co-evt');
    expect(companyRow?.asset_name).toBeNull();
    expect(companyRow?.trial_name).toBeNull();

    const assetRow = out.find((r) => r.marker_id === 'asset-evt');
    expect(assetRow?.asset_name).toBe('CagriSema');
    expect(assetRow?.trial_name).toBeNull();

    const trialRow = out.find((r) => r.marker_id === 'trial-evt');
    expect(trialRow?.trial_acronym).toBe('TRIAL-1');

    // Projection tier is carried through so the side-rail glyph can render the
    // same projection badge as the timeline.
    expect(companyRow?.projection).toBe('projected');
  });
});
