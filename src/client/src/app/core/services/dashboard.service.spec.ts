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
import {
  deriveTrialPhaseSpan,
  TRIAL_START_MARKER_TYPE_ID,
  TRIAL_END_MARKER_TYPE_ID,
} from '../models/trial-phase-span';

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

  it('preserves the flat marker_type_id so the phase bar derives a span', () => {
    // Regression guard: get_dashboard_data emits each marker with BOTH a flat
    // marker_type_id and a nested marker_type object. mapDashboardCompanies maps
    // the marker with a `...m` spread, so the flat field must survive. The client
    // phase bar derives its span via deriveTrialPhaseSpan, which matches markers
    // on the flat marker_type_id; if the RPC (or this mapping) dropped it, every
    // phase bar on the dashboard / landscape / pptx-export would render nothing.
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
                trials: [
                  {
                    id: 't1',
                    name: 'Trial One',
                    markers: [
                      {
                        id: 'm-start',
                        marker_type_id: TRIAL_START_MARKER_TYPE_ID,
                        event_date: '2023-01-15',
                        date_precision: 'exact',
                        marker_type: { id: TRIAL_START_MARKER_TYPE_ID, name: 'Trial Start' },
                      },
                      {
                        id: 'm-end',
                        marker_type_id: TRIAL_END_MARKER_TYPE_ID,
                        event_date: '2024-12-15',
                        date_precision: 'exact',
                        marker_type: { id: TRIAL_END_MARKER_TYPE_ID, name: 'Trial End' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const companies = mapDashboardCompanies(raw);
    const trial = companies[0].assets[0].trials[0];

    // The flat marker_type_id survives the `...m` spread.
    expect(trial.markers.map((m: { marker_type_id: string }) => m.marker_type_id)).toEqual([
      TRIAL_START_MARKER_TYPE_ID,
      TRIAL_END_MARKER_TYPE_ID,
    ]);

    // And the phase bar span derives correctly from the mapped markers.
    const span = deriveTrialPhaseSpan(trial.markers);
    expect(span.start).toBe('2023-01-15');
    expect(span.end).toBe('2024-12-15');
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
