import { describe, expect, it } from 'vitest';
import { commitSummary } from './commit-summary.logic';

describe('commitSummary', () => {
  it('counts rows actually inserted across all entity types, not the selection', () => {
    const created = {
      companies: ['c1'],
      assets: ['a1'],
      trials: ['t1'],
      markers: ['m1', 'm2'],
      events: ['e1'],
    };
    expect(commitSummary(created, 'Press Release')).toBe(
      'Committed 6 new items from Press Release. View in timeline.'
    );
  });

  it('uses the singular noun for a single new row', () => {
    expect(commitSummary({ events: ['e1'] }, 'Filing')).toBe('Committed 1 new item from Filing.');
  });

  it('omits "View in timeline" when no markers were created (events only)', () => {
    // Events do not render on the trial timeline, so the link would mislead.
    expect(commitSummary({ events: ['e1', 'e2'] }, 'Deal')).toBe(
      'Committed 2 new items from Deal.'
    );
  });

  it('appends "View in timeline" when markers were created', () => {
    expect(commitSummary({ markers: ['m1'] }, 'Readout')).toBe(
      'Committed 1 new item from Readout. View in timeline.'
    );
  });

  it('reports nothing-new honestly when every proposal matched an existing record', () => {
    expect(commitSummary({ companies: [], assets: [], trials: [], markers: [], events: [] }, 'Reworded PR')).toBe(
      'No new items from Reworded PR. Everything matched existing records.'
    );
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
