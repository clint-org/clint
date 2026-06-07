/**
 * Unit tests for the get_dashboard_data response mapping. Guards the
 * `_indication` augmentation that the client-side indication filter
 * (filterDashboardData) relies on: trials nested under an indication must
 * carry the indication entity id under `_indication.indication_id`. The RPC
 * emits that entity id as `id` on the indication object, so the mapping has to
 * translate it -- a regression here silently empties the timeline whenever the
 * Indication filter is used.
 */
import { describe, expect, it } from 'vitest';

import { mapDashboardCompanies } from './dashboard.service';

describe('mapDashboardCompanies', () => {
  it('surfaces the indication entity id as _indication.indication_id on nested trials', () => {
    const raw = [
      {
        id: 'co1',
        name: 'Acme',
        assets: [
          {
            id: 'as1',
            name: 'DrugX',
            indications: [
              {
                id: 'ind-onc',
                name: 'Oncology',
                abbreviation: 'ONC',
                development_status: 'P2',
                trials: [{ id: 't1', name: 'Trial One' }],
              },
            ],
          },
        ],
      },
    ];

    const companies = mapDashboardCompanies(raw);
    const trial = companies[0].assets[0].trials[0];

    // filterDashboardData matches filters.indicationIds against
    // _indication.indication_id, so the mapping MUST expose the entity id there.
    expect(trial._indication.indication_id).toBe('ind-onc');
    expect(trial._indication.indication_name).toBe('Oncology');
  });

  it('falls back to asset.trials when an asset has no indication grouping', () => {
    const raw = [
      {
        id: 'co1',
        name: 'Acme',
        assets: [{ id: 'as1', name: 'DrugX', trials: [{ id: 't9', name: 'Ungrouped' }] }],
      },
    ];

    const companies = mapDashboardCompanies(raw);

    expect(companies[0].assets[0].trials).toHaveLength(1);
    expect(companies[0].assets[0].trials[0].id).toBe('t9');
  });
});
