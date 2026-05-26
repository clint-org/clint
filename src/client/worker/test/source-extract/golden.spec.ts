import { describe, it, expect } from 'vitest';
import { validateExtraction } from '../../source-extract/response-validator';
import type { InventorySnapshot } from '../../source-extract/types';
import fixture from '../../source-extract/__fixtures__/pfizer-press-release.json';

const fixtureJson = JSON.stringify(fixture);

const SOURCE_TEXT =
  'Pfizer Inc reported Q1 2026 results. Paxlovid revenues reached $1.2B. ' +
  'Eikon Therapeutics initiated a Phase 1 first-in-human study of ETX-101 (ETX-101-001). ' +
  'The Phase 3 ATTAIN-1 trial continues to enroll.';

const inventory: InventorySnapshot = {
  companies: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Pfizer' }],
  assets: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Paxlovid',
      company_id: '11111111-1111-4111-8111-111111111111',
    },
  ],
  trials: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'ATTAIN-1',
      asset_id: '22222222-2222-4222-8222-222222222222',
    },
  ],
  indications: [],
  marker_types: [{ id: 'mt1', name: 'Topline Data' }],
  event_categories: [{ id: 'ec1', name: 'Clinical' }],
  hash: 'golden',
};

describe('golden fixture', () => {
  it('validates the Pfizer press release fixture with no dropped entities', () => {
    const r = validateExtraction(fixtureJson, inventory, SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dropped).toHaveLength(0);
      expect(r.result.companies).toHaveLength(2);
      expect(r.result.assets).toHaveLength(2);
      expect(r.result.trials).toHaveLength(2);
      expect(r.result.markers).toHaveLength(2);
      expect(r.result.events).toHaveLength(1);
    }
  });
});
