import { describe, it, expect } from 'vitest';
import { sectionHashUrl } from './section-hash-url';

describe('sectionHashUrl', () => {
  it('preserves the current route path and appends the fragment', () => {
    expect(sectionHashUrl('/t/a/s/b/trial/c', '', 'markers')).toBe('/t/a/s/b/trial/c#markers');
  });

  it('preserves the query string', () => {
    expect(sectionHashUrl('/t/a/s/b/trial/c', '?tab=1', 'timeline')).toBe(
      '/t/a/s/b/trial/c?tab=1#timeline'
    );
  });

  it('does not collapse to a base-relative "/#id" (the route-dropping regression)', () => {
    expect(sectionHashUrl('/t/a/s/b/trial/c', '', 'markers')).not.toBe('/#markers');
  });
});
