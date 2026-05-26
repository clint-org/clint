import { describe, it, expect } from 'vitest';
import {
  computeFuzzyAlternates,
  type NewEntity,
} from '../../source-extract/fuzzy-alternates';
import type { InventorySnapshot } from '../../source-extract/types';

function makeInventory(
  companies: { id: string; name: string }[] = [],
): InventorySnapshot {
  return {
    companies,
    assets: [],
    trials: [],
    indications: [],
    hash: 'h1',
  };
}

describe('computeFuzzyAlternates', () => {
  it('returns empty for entities with no similar inventory items', () => {
    const entities: NewEntity[] = [
      { type: 'company', index: 0, name: 'ZZZZZ Totally Unique Corp' },
    ];
    const inv = makeInventory([{ id: 'c1', name: 'Pfizer' }]);
    const result = computeFuzzyAlternates(entities, inv);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('returns top 3 sorted by score descending', () => {
    const entities: NewEntity[] = [
      { type: 'company', index: 0, name: 'Pfizer' },
    ];
    const inv = makeInventory([
      { id: 'c1', name: 'Pfizer Inc' },
      { id: 'c2', name: 'Pfizer Ltd' },
      { id: 'c3', name: 'Pfizer Corp' },
      { id: 'c4', name: 'Pfizer Global' },
    ]);
    const result = computeFuzzyAlternates(entities, inv);
    const alts = result['company_0'];
    expect(alts).toBeDefined();
    expect(alts.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < alts.length; i++) {
      expect(alts[i - 1].score).toBeGreaterThanOrEqual(alts[i].score);
    }
  });

  it('filters out low-similarity items at the 0.7 threshold', () => {
    const entities: NewEntity[] = [
      { type: 'company', index: 0, name: 'Alpha' },
    ];
    const inv = makeInventory([
      { id: 'c1', name: 'ZZZZZ Totally Different' },
    ]);
    const result = computeFuzzyAlternates(entities, inv);
    expect(result['company_0']).toBeUndefined();
  });

  it('keys results by type_index format', () => {
    const entities: NewEntity[] = [
      { type: 'asset', index: 2, name: 'Paxlovid' },
    ];
    const inv: InventorySnapshot = {
      companies: [],
      assets: [{ id: 'a1', name: 'Paxlovid SR', company_id: 'c1' }],
      trials: [],
      indications: [],
      hash: 'h1',
    };
    const result = computeFuzzyAlternates(entities, inv);
    expect(result['asset_2']).toBeDefined();
  });
});
