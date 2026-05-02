import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, corsHeaders, preflight } from '../cors';

const ALLOW = ['clintapp.com'];

describe('isAllowedOrigin', () => {
  it('accepts the apex', () => {
    expect(isAllowedOrigin('https://clintapp.com', ALLOW)).toBe(true);
  });
  it('accepts subdomains', () => {
    expect(isAllowedOrigin('https://pfizer.clintapp.com', ALLOW)).toBe(true);
  });
  it('rejects non-matching origins', () => {
    expect(isAllowedOrigin('https://evil.com', ALLOW)).toBe(false);
  });
  it('rejects missing origin', () => {
    expect(isAllowedOrigin(null, ALLOW)).toBe(false);
  });
  it('rejects look-alike suffixes', () => {
    expect(isAllowedOrigin('https://notclintapp.com', ALLOW)).toBe(false);
  });
});

describe('corsHeaders', () => {
  it('echoes allowed origin', () => {
    const h = corsHeaders('https://pfizer.clintapp.com', ALLOW);
    expect(h['Access-Control-Allow-Origin']).toBe('https://pfizer.clintapp.com');
    expect(h['Vary']).toBe('Origin');
  });
  it('omits ACAO for disallowed origin', () => {
    const h = corsHeaders('https://evil.com', ALLOW);
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('preflight', () => {
  it('returns 204 for allowed origin', () => {
    const req = new Request('https://x/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pfizer.clintapp.com' },
    });
    const res = preflight(req, ALLOW);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
  it('returns 403 for disallowed origin', () => {
    const req = new Request('https://x/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com' },
    });
    const res = preflight(req, ALLOW);
    expect(res.status).toBe(403);
  });
});
