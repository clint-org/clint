import { describe, it, expect } from 'vitest';
import { chunkBy, groupByNct } from '../../ctgov-sync/batch';
import type { PollingTrialRow } from '../../ctgov-sync/types';

describe('chunkBy', () => {
  it('returns [] for empty input', () => {
    expect(chunkBy([], 10)).toEqual([]);
  });

  it('splits into N-sized chunks with a smaller final chunk', () => {
    expect(chunkBy([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when size is larger than input', () => {
    expect(chunkBy([1, 2], 5)).toEqual([[1, 2]]);
  });

  it('returns a single chunk on exact fit', () => {
    expect(chunkBy([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });
});

describe('groupByNct', () => {
  it('returns empty Map for empty input', () => {
    const result = groupByNct([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('groups multiple rows sharing an NCT', () => {
    const rows: PollingTrialRow[] = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-04-01',
      },
      {
        trial_id: 't2',
        space_id: 's2',
        nct_id: 'NCT02',
        last_update_posted_date: '2026-03-15',
      },
      {
        trial_id: 't3',
        space_id: 's3',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-04-01',
      },
    ];
    const result = groupByNct(rows);
    expect(result.size).toBe(2);
    expect(result.get('NCT01')).toHaveLength(2);
    expect(result.get('NCT02')).toHaveLength(1);
  });

  it('preserves insertion order within each group', () => {
    const rows: PollingTrialRow[] = [
      {
        trial_id: 't-first',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: null,
      },
      {
        trial_id: 't-second',
        space_id: 's2',
        nct_id: 'NCT01',
        last_update_posted_date: null,
      },
      {
        trial_id: 't-third',
        space_id: 's3',
        nct_id: 'NCT01',
        last_update_posted_date: null,
      },
    ];
    const result = groupByNct(rows);
    const grouped = result.get('NCT01');
    expect(grouped?.map((r) => r.trial_id)).toEqual(['t-first', 't-second', 't-third']);
  });
});
