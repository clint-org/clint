import { test, expect } from '@playwright/test';
import { errorMessage } from './error-message';

test.describe('errorMessage', () => {
  test('returns Error.message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
  test('returns PostgrestError.message', () => {
    const pg = { code: '42501', message: 'forbidden', details: null, hint: null, name: 'PostgrestError' };
    expect(errorMessage(pg)).toBe('forbidden');
  });
  test('returns Response.statusText with status', () => {
    const r = new Response(null, { status: 429, statusText: 'Too Many Requests' });
    expect(errorMessage(r)).toBe('429 Too Many Requests');
  });
  test('returns string passthrough', () => {
    expect(errorMessage('plain')).toBe('plain');
  });
  test('returns fallback for unknown shapes', () => {
    expect(errorMessage(undefined)).toBe('Unknown error');
    expect(errorMessage(null)).toBe('Unknown error');
    expect(errorMessage({})).toBe('Unknown error');
  });
});
