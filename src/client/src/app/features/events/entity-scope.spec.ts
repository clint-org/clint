import { describe, expect, it } from 'vitest';
import { parseEntityScope } from './entity-scope';

describe('parseEntityScope', () => {
  it('parses a valid trial / product / company scope from query params', () => {
    expect(parseEntityScope('trial', 't1')).toEqual({ entityLevel: 'trial', entityId: 't1' });
    expect(parseEntityScope('product', 'a1')).toEqual({ entityLevel: 'product', entityId: 'a1' });
    expect(parseEntityScope('company', 'c1')).toEqual({ entityLevel: 'company', entityId: 'c1' });
  });

  it('returns null when the entity id is missing', () => {
    expect(parseEntityScope('trial', null)).toBeNull();
    expect(parseEntityScope('trial', '')).toBeNull();
  });

  it('returns null when the level is missing or not scopable', () => {
    expect(parseEntityScope(null, 't1')).toBeNull();
    expect(parseEntityScope('space', 's1')).toBeNull();
    expect(parseEntityScope('bogus', 'x1')).toBeNull();
  });
});
