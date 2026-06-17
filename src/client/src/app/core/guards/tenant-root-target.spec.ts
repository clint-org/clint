import { describe, expect, it } from 'vitest';

import { resolveTenantRootTarget } from './tenant-root-target';

describe('resolveTenantRootTarget', () => {
  it('routes straight into the only accessible space', () => {
    expect(resolveTenantRootTarget(['s1'], null)).toEqual({ kind: 'space', spaceId: 's1' });
  });

  it('ignores a stale last-space when there is exactly one accessible space', () => {
    expect(resolveTenantRootTarget(['s1'], 's9')).toEqual({ kind: 'space', spaceId: 's1' });
  });

  it('honours the last-opened space when it is accessible in this tenant', () => {
    expect(resolveTenantRootTarget(['s1', 's2', 's3'], 's2')).toEqual({
      kind: 'space',
      spaceId: 's2',
    });
  });

  it('falls back to the picker when the last space is not accessible here', () => {
    expect(resolveTenantRootTarget(['s1', 's2'], 's9')).toEqual({ kind: 'picker' });
  });

  it('shows the picker for multiple spaces with no last-space hint', () => {
    expect(resolveTenantRootTarget(['s1', 's2'], null)).toEqual({ kind: 'picker' });
  });

  it('shows the picker when the user can access no space in this tenant', () => {
    expect(resolveTenantRootTarget([], null)).toEqual({ kind: 'picker' });
    expect(resolveTenantRootTarget([], 's1')).toEqual({ kind: 'picker' });
  });
});
