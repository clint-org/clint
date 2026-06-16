import { describe, expect, it } from 'vitest';

import { userDisplayName } from './user-display-name';

describe('userDisplayName', () => {
  it('prefers full_name', () => {
    expect(userDisplayName('Daniel Reyes', 'dreyes', 'd@x.com')).toBe('Daniel Reyes');
  });

  it('falls back to name when full_name is blank', () => {
    expect(userDisplayName('  ', 'dreyes', 'd@x.com')).toBe('dreyes');
    expect(userDisplayName(null, 'dreyes', 'd@x.com')).toBe('dreyes');
  });

  it('falls back to the email local-part when no name is set', () => {
    expect(userDisplayName(null, null, 'space_owner@personas.test')).toBe('space_owner');
  });

  it('returns "Account" when nothing resolves', () => {
    expect(userDisplayName(null, undefined, '')).toBe('Account');
    expect(userDisplayName(null, undefined, undefined)).toBe('Account');
  });
});
