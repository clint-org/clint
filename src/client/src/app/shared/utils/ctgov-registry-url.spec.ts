import { describe, it, expect } from 'vitest';
import { ctgovRegistryUrl } from './ctgov-registry-url';

describe('ctgovRegistryUrl', () => {
  it('returns the study URL for a valid NCT identifier', () => {
    expect(ctgovRegistryUrl('NCT04184622')).toBe(
      'https://clinicaltrials.gov/study/NCT04184622',
    );
  });

  it('trims whitespace from the identifier before building the URL', () => {
    expect(ctgovRegistryUrl('  NCT04184622  ')).toBe(
      'https://clinicaltrials.gov/study/NCT04184622',
    );
  });

  it('returns null for null', () => {
    expect(ctgovRegistryUrl(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(ctgovRegistryUrl(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(ctgovRegistryUrl('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(ctgovRegistryUrl('   ')).toBeNull();
  });
});
