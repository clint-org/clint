import { describe, it, expect } from 'vitest';
import { isExistingWorkspace } from './workspace-finder';

describe('isExistingWorkspace', () => {
  it('treats a tenant host as an existing workspace', () => {
    expect(isExistingWorkspace({ kind: 'tenant' })).toBe(true);
  });

  it('treats an agency host as an existing workspace', () => {
    expect(isExistingWorkspace({ kind: 'agency' })).toBe(true);
  });

  it('treats a super-admin host as an existing workspace', () => {
    expect(isExistingWorkspace({ kind: 'super-admin' })).toBe(true);
  });

  it('treats the default (unknown host) brand as not found', () => {
    expect(isExistingWorkspace({ kind: 'default' })).toBe(false);
  });

  it('treats a null lookup result as not found', () => {
    expect(isExistingWorkspace(null)).toBe(false);
  });

  it('treats a missing kind as not found', () => {
    expect(isExistingWorkspace({})).toBe(false);
  });
});
