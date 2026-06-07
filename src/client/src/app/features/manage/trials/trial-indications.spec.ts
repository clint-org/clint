import { describe, expect, it } from 'vitest';
import { fetchIndicationsSafe } from './trial-indications';

describe('fetchIndicationsSafe', () => {
  it('returns the fetched indications on success', async () => {
    const result = await fetchIndicationsSafe(async () => [
      { id: 'i1', name: 'NSCLC' },
      { id: 'i2', name: 'Melanoma' },
    ]);
    expect(result).toEqual([
      { id: 'i1', name: 'NSCLC' },
      { id: 'i2', name: 'Melanoma' },
    ]);
  });

  it('returns an empty array when the fetcher throws', async () => {
    const result = await fetchIndicationsSafe(async () => {
      throw new Error('network down');
    });
    expect(result).toEqual([]);
  });

  it('returns an empty array when the fetcher resolves empty', async () => {
    const result = await fetchIndicationsSafe(async () => []);
    expect(result).toEqual([]);
  });
});
