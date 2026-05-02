import { describe, it, expect } from 'vitest';
import { mapSupabaseError, errorResponse } from '../errors';

describe('mapSupabaseError', () => {
  it('maps 42501 to 403 forbidden', () => {
    expect(mapSupabaseError({ code: '42501', message: 'forbidden' }))
      .toEqual({ status: 403, body: { error: 'forbidden' } });
  });
  it('maps P0002 to 404 not_found', () => {
    expect(mapSupabaseError({ code: 'P0002', message: 'material not found' }))
      .toEqual({ status: 404, body: { error: 'not_found' } });
  });
  it('maps 22023 to 422 with original message', () => {
    expect(mapSupabaseError({ code: '22023', message: 'invalid material_type: foo' }))
      .toEqual({ status: 422, body: { error: 'invalid material_type: foo' } });
  });
  it('passes through 401 from PostgREST as unauthenticated', () => {
    expect(mapSupabaseError({ httpStatus: 401, message: 'JWT expired' }))
      .toEqual({ status: 401, body: { error: 'unauthenticated' } });
  });
  it('falls through to 500 for anything unmapped', () => {
    expect(mapSupabaseError({ code: 'X', message: 'weird' }))
      .toEqual({ status: 500, body: { error: 'internal' } });
  });
});

describe('errorResponse', () => {
  it('sets json content-type and merges cors headers', () => {
    const res = errorResponse(403, 'forbidden', { 'Access-Control-Allow-Origin': 'https://x' });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://x');
  });
});
