import { describe, it, expect } from 'vitest';

import { resolveScopeFromSnapshot, ScopeSnapshot } from './route-scope';

function snap(params: Record<string, string>, parent: ScopeSnapshot | null = null): ScopeSnapshot {
  return {
    paramMap: {
      has: (n: string) => n in params,
      get: (n: string) => params[n] ?? null,
    },
    parent,
  };
}

describe('resolveScopeFromSnapshot', () => {
  it('returns nulls for a null snapshot', () => {
    expect(resolveScopeFromSnapshot(null)).toEqual({ tenantId: null, spaceId: null });
  });

  it('reads tenant and space from the same node', () => {
    expect(resolveScopeFromSnapshot(snap({ tenantId: 't1', spaceId: 's1' }))).toEqual({
      tenantId: 't1',
      spaceId: 's1',
    });
  });

  it('walks up the parent chain to find ancestor ids', () => {
    const leaf = snap({}, snap({ spaceId: 's9' }, snap({ tenantId: 't9' })));
    expect(resolveScopeFromSnapshot(leaf)).toEqual({ tenantId: 't9', spaceId: 's9' });
  });

  it('prefers the nearest node when an id appears at multiple levels', () => {
    const leaf = snap({ tenantId: 'near' }, snap({ tenantId: 'far', spaceId: 's' }));
    expect(resolveScopeFromSnapshot(leaf)).toEqual({ tenantId: 'near', spaceId: 's' });
  });
});
