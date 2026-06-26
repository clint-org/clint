import { describe, expect, it } from 'vitest';

import { Space } from '../../core/models/space.model';
import { foldCreatedSpace } from './space-list.create';

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: 'new-space',
    tenant_id: 't1',
    name: 'Test',
    description: null,
    created_at: '2026-06-25T00:00:00Z',
    created_by: 'u1',
    archived_at: null,
    ...overrides,
  } as Space;
}

describe('foldCreatedSpace', () => {
  it('adds the new space id to the accessible set (creator is the owner)', () => {
    // Regression guard: create_space inserts the owner space_members row
    // atomically, so the caller can always enter the space they just made.
    // The list caches accessibleIds as a snapshot taken on load; without
    // folding the new id in, canOpen() reads a stale set and openSpace()
    // falsely reports "No access to this space".
    const created = makeSpace({ id: 's-new' });
    const next = foldCreatedSpace(
      { spaces: [makeSpace({ id: 's-old' })], accessibleIds: new Set(['s-old']) },
      created
    );
    expect(next.accessibleIds.has('s-new')).toBe(true);
    expect(next.accessibleIds.has('s-old')).toBe(true);
  });

  it('appends the new space to the list (preserves created_at ordering)', () => {
    const created = makeSpace({ id: 's-new' });
    const next = foldCreatedSpace(
      { spaces: [makeSpace({ id: 's-old' })], accessibleIds: new Set() },
      created
    );
    expect(next.spaces.map((s) => s.id)).toEqual(['s-old', 's-new']);
  });

  it('does not mutate the input set or array', () => {
    const inputIds = new Set(['s-old']);
    const inputSpaces = [makeSpace({ id: 's-old' })];
    foldCreatedSpace({ spaces: inputSpaces, accessibleIds: inputIds }, makeSpace({ id: 's-new' }));
    expect(inputIds.has('s-new')).toBe(false);
    expect(inputSpaces).toHaveLength(1);
  });
});
