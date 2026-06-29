import { describe, expect, it } from 'vitest';
import { commitSummary } from './commit-summary.logic';

describe('commitSummary', () => {
  it('counts rows actually inserted across all entity types, not the selection', () => {
    const created = {
      companies: ['c1'],
      assets: ['a1'],
      trials: ['t1'],
      events: ['e1'],
    };
    expect(commitSummary(created, 'Press Release')).toBe(
      'Committed 4 new items from Press Release. View in timeline.'
    );
  });

  it('uses the singular noun for a single new row', () => {
    expect(commitSummary({ assets: ['a1'] }, 'Filing')).toBe('Committed 1 new item from Filing.');
  });

  it('appends "View in timeline" when events were created', () => {
    expect(commitSummary({ events: ['e1', 'e2'] }, 'Deal')).toBe(
      'Committed 2 new items from Deal. View in timeline.'
    );
  });

  it('points to the timeline when events landed', () => {
    expect(commitSummary({ events: ['e1'] }, 'Doc')).toBe(
      'Committed 1 new item from Doc. View in timeline.'
    );
  });

  it('reports nothing-new honestly when every proposal matched an existing record', () => {
    expect(
      commitSummary({ companies: [], assets: [], trials: [], events: [] }, 'Reworded PR')
    ).toBe('No new items from Reworded PR. Everything matched existing records.');
  });

  it('treats a missing/null created payload as nothing new', () => {
    expect(commitSummary(null, 'source')).toBe(
      'No new items from source. Everything matched existing records.'
    );
    expect(commitSummary(undefined, 'source')).toBe(
      'No new items from source. Everything matched existing records.'
    );
  });
});
