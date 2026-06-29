import { describe, it, expect } from 'vitest';
import { flattenToCatalysts } from './landscape-state.service';
import type { Company } from '../../core/models/company.model';

const TODAY = '2026-01-01';

/** Minimal future-event marker; only the fields flattenToCatalysts reads. */
function ev(id: string, title: string, event_date: string) {
  return {
    id,
    title,
    event_date,
    is_projected: true,
    projection: 'company',
    marker_types: { category_id: 'c1', name: 'Regulatory Filing', color: '#f97316', shape: 'hexagon', inner_mark: 'none', marker_categories: { name: 'Regulatory' } },
  };
}

/** A company with a company-anchored event, an asset-anchored event, and a trial-anchored marker. */
function fixture(): Company[] {
  return [
    {
      id: 'co1',
      name: 'Acme Bio',
      events: [ev('co-ev', 'Company leadership change', '2026-05-01')],
      assets: [
        {
          id: 'as1',
          name: 'ACME-1',
          events: [ev('as-ev', 'Asset Regulatory Filing', '2026-10-01')],
          trials: [{ id: 'tr1', name: 'SUMMIT', markers: [ev('tr-ev', 'Topline readout', '2026-06-01'), ev('past', 'Old readout', '2025-06-01')] }],
        },
      ],
    },
  ] as unknown as Company[];
}

describe('flattenToCatalysts (QA-010: all anchor levels)', () => {
  it('includes company-, asset-, and trial-anchored future events', () => {
    const out = flattenToCatalysts(fixture(), TODAY);
    const ids = out.map((c) => c.marker_id);
    expect(ids).toContain('co-ev'); // company-anchored
    expect(ids).toContain('as-ev'); // asset-anchored
    expect(ids).toContain('tr-ev'); // trial-anchored
  });

  it('excludes past events (event_date < today)', () => {
    const ids = flattenToCatalysts(fixture(), TODAY).map((c) => c.marker_id);
    expect(ids).not.toContain('past');
  });

  it('sets anchor context: company-anchored has null asset/trial; asset-anchored has asset but null trial', () => {
    const out = flattenToCatalysts(fixture(), TODAY);
    const co = out.find((c) => c.marker_id === 'co-ev')!;
    expect(co.company_id).toBe('co1');
    expect(co.asset_id).toBeNull();
    expect(co.trial_id).toBeNull();

    const as = out.find((c) => c.marker_id === 'as-ev')!;
    expect(as.asset_id).toBe('as1');
    expect(as.trial_id).toBeNull();

    const tr = out.find((c) => c.marker_id === 'tr-ev')!;
    expect(tr.trial_id).toBe('tr1');
  });

  it('carries the projection tier so catalyst glyphs render the timeline badge', () => {
    const co = flattenToCatalysts(fixture(), TODAY).find((c) => c.marker_id === 'co-ev')!;
    expect(co.projection).toBe('company');
  });
});
