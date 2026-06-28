import { describe, expect, it } from 'vitest';
import { parseEntityScope, scopeChipLabel, scopeRollupSuffix } from './entity-scope';

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

describe('scopeRollupSuffix', () => {
  it('names the descendant levels each scope rolls up', () => {
    expect(scopeRollupSuffix('company')).toBe(' + assets & trials');
    expect(scopeRollupSuffix('product')).toBe(' + trials');
    expect(scopeRollupSuffix('trial')).toBe('');
  });
});

describe('scopeChipLabel', () => {
  it('appends the rollup suffix to the entity name', () => {
    expect(scopeChipLabel('company', 'Eli Lilly')).toBe('Eli Lilly + assets & trials');
    expect(scopeChipLabel('product', 'Tirzepatide')).toBe('Tirzepatide + trials');
    expect(scopeChipLabel('trial', 'SURMOUNT-1')).toBe('SURMOUNT-1');
  });

  it('falls back to the level noun when the name is unknown', () => {
    expect(scopeChipLabel('company', null)).toBe('this company and everything beneath it');
    expect(scopeChipLabel('product', '')).toBe('this asset and everything beneath it');
    expect(scopeChipLabel('trial', '   ')).toBe('this trial and everything beneath it');
  });
});
