import { describe, expect, it } from 'vitest';
import { EntityNounPipe } from './entity-noun.pipe';

describe('EntityNounPipe', () => {
  const pipe = new EntityNounPipe();

  it('maps the data-model "product" level to the user-facing "asset"', () => {
    expect(pipe.transform('product')).toBe('asset');
  });

  it('passes other levels through unchanged', () => {
    expect(pipe.transform('trial')).toBe('trial');
    expect(pipe.transform('company')).toBe('company');
    expect(pipe.transform('space')).toBe('space');
  });

  it('returns an empty string for null/undefined', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
