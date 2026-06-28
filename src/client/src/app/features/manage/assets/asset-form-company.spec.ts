import { describe, expect, it } from 'vitest';
import { resolveCreateCompanyId } from './asset-form-company';

describe('resolveCreateCompanyId', () => {
  it('returns the locked company when one is supplied', () => {
    expect(
      resolveCreateCompanyId({ lockedCompanyId: 'co-locked', companyIds: ['co-1', 'co-2'] })
    ).toBe('co-locked');
  });

  it('falls back to the first company when nothing is locked', () => {
    expect(resolveCreateCompanyId({ lockedCompanyId: null, companyIds: ['co-1', 'co-2'] })).toBe(
      'co-1'
    );
  });

  it('prefers the locked company even when the option list is empty', () => {
    expect(resolveCreateCompanyId({ lockedCompanyId: 'co-locked', companyIds: [] })).toBe(
      'co-locked'
    );
  });

  it('returns empty string when nothing is locked and there are no companies', () => {
    expect(resolveCreateCompanyId({ lockedCompanyId: null, companyIds: [] })).toBe('');
  });
});
