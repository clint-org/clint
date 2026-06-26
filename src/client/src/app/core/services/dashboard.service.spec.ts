/**
 * Unit tests for the get_dashboard_data response mapping. Guards the
 * `_indications` augmentation that the client-side indication filter
 * (filterDashboardData) relies on: each trial must carry the indication entity
 * id of every indication it is grouped under, under
 * `_indications[].indication_id`. The RPC emits that entity id as `id` on the
 * indication object, so the mapping has to translate it -- a regression here
 * silently empties the timeline whenever the Indication filter is used. The
 * mapping also dedupes by trial id: a trial nested under several indications
 * must render as ONE row (the timeline has no indication column), not one row
 * per indication.
 */
import { describe, expect, it } from 'vitest';

import { mapDashboardCompanies } from './dashboard.service';

describe('mapDashboardCompanies', () => {
  it('surfaces the indication entity id as _indications[].indication_id on nested trials', () => {
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
    // _indications[].indication_id, so the mapping MUST expose the entity id there.
    expect(trial._indications).toEqual([
      { id: 'ind-onc', indication_id: 'ind-onc', indication_name: 'Oncology' },
    ]);
  });

  it('renders a trial spanning multiple indications as a single deduped row', () => {
    // Regression guard: STEP 1 (NCT03548935) imported with conditions that map
    // to both Obesity and Overweight produced two identical timeline rows.
    const raw = [
      {
        id: 'co1',
        name: 'Novo Nordisk',
        assets: [
          {
            id: 'as1',
            name: 'Semaglutide',
            indications: [
              { id: 'ind-obesity', name: 'Obesity', trials: [{ id: 't1', name: 'STEP 1' }] },
              { id: 'ind-overweight', name: 'Overweight', trials: [{ id: 't1', name: 'STEP 1' }] },
            ],
          },
        ],
      },
    ];

    const companies = mapDashboardCompanies(raw);
    const trials = companies[0].assets[0].trials;

    expect(trials).toHaveLength(1);
    expect(trials[0].id).toBe('t1');
    // Both indications are preserved so the indication filter still matches either.
    expect(trials[0]._indications.map((i: { indication_id: string }) => i.indication_id)).toEqual([
      'ind-obesity',
      'ind-overweight',
    ]);
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

  it('carries ctgov_withdrawn_at from the RPC row onto the mapped trial', () => {
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
                id: 'ind1',
                name: 'Oncology',
                trials: [
                  { id: 't1', name: 'Trial A', ctgov_withdrawn_at: '2026-06-01T00:00:00Z' },
                  { id: 't2', name: 'Trial B' },
                ],
              },
            ],
          },
        ],
      },
    ];

    const companies = mapDashboardCompanies(raw);
    const trials = companies[0].assets[0].trials;

    // Trial with a withdrawal timestamp must carry it through.
    expect(trials.find((t: { id: string }) => t.id === 't1').ctgov_withdrawn_at).toBe(
      '2026-06-01T00:00:00Z'
    );
    // Trial missing the key must produce null, not undefined.
    expect(trials.find((t: { id: string }) => t.id === 't2').ctgov_withdrawn_at).toBeNull();
  });
});
