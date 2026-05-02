import { describe, it, expect } from 'vitest';
import { jwtSubject } from '../auth';

// Helper: build a JWT-shaped string (header.payload.sig) without signing.
function unsignedJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

describe('jwtSubject', () => {
  it('extracts sub from a Bearer token', () => {
    const token = unsignedJwt({ sub: 'user-abc', role: 'authenticated' });
    expect(jwtSubject(`Bearer ${token}`)).toBe('user-abc');
  });
  it('returns null for missing header', () => {
    expect(jwtSubject(null)).toBeNull();
  });
  it('returns null for non-Bearer header', () => {
    expect(jwtSubject('Basic abc')).toBeNull();
  });
  it('returns null for malformed token', () => {
    expect(jwtSubject('Bearer not.a.jwt!!')).toBeNull();
  });
  it('returns null for token with no sub', () => {
    const token = unsignedJwt({ role: 'authenticated' });
    expect(jwtSubject(`Bearer ${token}`)).toBeNull();
  });
});
