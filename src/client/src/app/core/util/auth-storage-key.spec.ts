import { describe, it, expect } from 'vitest';
import { authStorageKey } from './auth-storage-key';

describe('authStorageKey', () => {
  it('keeps the legacy sb-auth key in production', () => {
    // Renaming would sign every production user out and break the established
    // cross-subdomain SSO cookie.
    expect(authStorageKey('production')).toBe('sb-auth');
  });

  it('scopes the dev key so it never collides with the production cookie', () => {
    expect(authStorageKey('dev')).toBe('sb-auth-dev');
  });

  it('scopes the local key', () => {
    expect(authStorageKey('local')).toBe('sb-auth-local');
  });
});
