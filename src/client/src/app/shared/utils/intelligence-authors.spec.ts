import { describe, expect, it } from 'vitest';
import {
  initialsFromId,
  resolveAuthorName,
  resolveContributorLine,
  resolveOtherContributorsLine,
} from './intelligence-authors';

const UID = '00000000-0000-0000-0000-00000000000d';
const UID2 = '31abcdef-0000-0000-0000-000000000000';

describe('resolveAuthorName (P1.2)', () => {
  it('uses the payload authors map when present', () => {
    expect(resolveAuthorName(UID, { [UID]: 'Daniel Reyes' })).toBe('Daniel Reyes');
  });

  it('lets an explicit override win over the payload map', () => {
    expect(resolveAuthorName(UID, { [UID]: 'Payload Name' }, { [UID]: 'Override Name' })).toBe(
      'Override Name',
    );
  });

  it('falls back to UUID-prefix initials when no name resolves', () => {
    expect(resolveAuthorName(UID)).toBe('00');
    expect(resolveAuthorName(UID2, {})).toBe('31');
  });

  it('returns empty string for a null/undefined id', () => {
    expect(resolveAuthorName(null)).toBe('');
    expect(resolveAuthorName(undefined)).toBe('');
  });
});

describe('resolveContributorLine (P1.2)', () => {
  it('joins resolved names with commas', () => {
    expect(
      resolveContributorLine([UID, UID2], { [UID]: 'Daniel Reyes', [UID2]: 'Mara Singh' }),
    ).toBe('Daniel Reyes, Mara Singh');
  });

  it('mixes names and initials fallback', () => {
    expect(resolveContributorLine([UID, UID2], { [UID]: 'Daniel Reyes' })).toBe(
      'Daniel Reyes, 31',
    );
  });

  it('returns "--" for an empty or missing list', () => {
    expect(resolveContributorLine([])).toBe('--');
    expect(resolveContributorLine(null)).toBe('--');
  });
});

describe('resolveOtherContributorsLine', () => {
  const authors = { [UID]: 'Daniel Reyes', [UID2]: 'Mara Singh' };

  it('returns null when the only contributor is the lead', () => {
    expect(resolveOtherContributorsLine([UID], UID, authors)).toBeNull();
  });

  it('drops the lead and lists the remaining contributors', () => {
    expect(resolveOtherContributorsLine([UID, UID2], UID, authors)).toBe('Mara Singh');
  });

  it('returns null for an empty or missing list', () => {
    expect(resolveOtherContributorsLine([], UID, authors)).toBeNull();
    expect(resolveOtherContributorsLine(null, UID, authors)).toBeNull();
  });

  it('lists everyone when the lead is not among the contributors', () => {
    expect(resolveOtherContributorsLine([UID, UID2], null, authors)).toBe('Daniel Reyes, Mara Singh');
  });
});

describe('initialsFromId', () => {
  it('uppercases the first two chars', () => {
    expect(initialsFromId('abcdef')).toBe('AB');
  });
});
