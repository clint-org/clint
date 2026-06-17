import { describe, expect, it } from 'vitest';
import { isPermissionDenied } from './db-error';

describe('isPermissionDenied (P1.3b)', () => {
  it('detects SQLSTATE 42501 by code', () => {
    expect(isPermissionDenied({ code: '42501', message: 'permission denied for table x' })).toBe(
      true,
    );
  });

  it('detects a permission message without a code', () => {
    expect(isPermissionDenied({ message: 'permission denied for function upsert' })).toBe(true);
    expect(isPermissionDenied(new Error('not authorized to publish'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isPermissionDenied({ code: '23502', message: 'null value' })).toBe(false);
    expect(isPermissionDenied(new Error('network down'))).toBe(false);
  });

  it('returns false for null/undefined/non-objects', () => {
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
    expect(isPermissionDenied('42501')).toBe(false);
  });
});
