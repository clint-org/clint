import { describe, expect, it } from 'vitest';

import { landscapeAllTag } from './cache-tags';

describe('landscapeAllTag', () => {
  it('builds the per-space umbrella tag', () => {
    expect(landscapeAllTag('space-1')).toBe('space:space-1:landscape-all');
  });

  it('is space-scoped (a different space yields a different tag)', () => {
    expect(landscapeAllTag('a')).not.toBe(landscapeAllTag('b'));
  });
});
