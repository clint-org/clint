import { describe, expect, it } from 'vitest';
import { agencyDeleteConfirmed } from './agency-delete-confirm';

describe('agencyDeleteConfirmed', () => {
  it('returns true on an exact name match', () => {
    expect(agencyDeleteConfirmed('Acme Agency', 'Acme Agency')).toBe(true);
  });

  it('trims whitespace on both sides before comparing', () => {
    expect(agencyDeleteConfirmed('  Acme Agency  ', 'Acme Agency')).toBe(true);
    expect(agencyDeleteConfirmed('Acme Agency', '  Acme Agency  ')).toBe(true);
  });

  it('returns false when the typed text differs', () => {
    expect(agencyDeleteConfirmed('acme agency', 'Acme Agency')).toBe(false);
    expect(agencyDeleteConfirmed('Acme', 'Acme Agency')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(agencyDeleteConfirmed('', 'Acme Agency')).toBe(false);
    expect(agencyDeleteConfirmed('   ', 'Acme Agency')).toBe(false);
  });

  it('never matches when the agency name is empty or whitespace', () => {
    expect(agencyDeleteConfirmed('', '')).toBe(false);
    expect(agencyDeleteConfirmed('   ', '   ')).toBe(false);
    expect(agencyDeleteConfirmed('anything', '')).toBe(false);
  });
});
