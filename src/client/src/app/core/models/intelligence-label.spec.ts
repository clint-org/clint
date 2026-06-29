import { describe, it, expect } from 'vitest';
import type { Brand } from './brand.model';
import { resolveAgencyName, resolveIntelligenceLabel } from './intelligence-label';

function makeBrand(overrides: Partial<Brand>): Brand {
  return {
    kind: 'default',
    id: null,
    app_display_name: 'Clint',
    logo_url: null,
    favicon_url: null,
    primary_color: '#0d9488',
    auth_providers: ['google'],
    has_self_join: false,
    suspended: false,
    agency: null,
    ...overrides,
  };
}

describe('resolveAgencyName', () => {
  it('returns app_display_name on an agency host', () => {
    expect(resolveAgencyName(makeBrand({ kind: 'agency', app_display_name: 'Stout' }))).toBe('Stout');
  });

  it('returns the parent agency name on a tenant host', () => {
    const brand = makeBrand({ kind: 'tenant', app_display_name: 'Pfizer', agency: { name: 'Stout', logo_url: null } });
    expect(resolveAgencyName(brand)).toBe('Stout');
  });

  it('returns null on a tenant host with no agency', () => {
    expect(resolveAgencyName(makeBrand({ kind: 'tenant', agency: null }))).toBeNull();
  });

  it('returns null on super-admin and default hosts', () => {
    expect(resolveAgencyName(makeBrand({ kind: 'super-admin' }))).toBeNull();
    expect(resolveAgencyName(makeBrand({ kind: 'default' }))).toBeNull();
  });

  it('treats a blank or whitespace agency name as no agency', () => {
    expect(resolveAgencyName(makeBrand({ kind: 'tenant', agency: { name: '  ', logo_url: null } }))).toBeNull();
    expect(resolveAgencyName(makeBrand({ kind: 'agency', app_display_name: '' }))).toBeNull();
  });
});

describe('resolveIntelligenceLabel', () => {
  it('composes "{Agency} intelligence" when an agency resolves', () => {
    expect(resolveIntelligenceLabel(makeBrand({ kind: 'agency', app_display_name: 'Stout' }))).toBe('Stout intelligence');
    const tenant = makeBrand({ kind: 'tenant', agency: { name: 'Acme CI', logo_url: null } });
    expect(resolveIntelligenceLabel(tenant)).toBe('Acme CI intelligence');
  });

  it('falls back to plain "Intelligence" when no agency resolves', () => {
    expect(resolveIntelligenceLabel(makeBrand({ kind: 'default' }))).toBe('Intelligence');
    expect(resolveIntelligenceLabel(makeBrand({ kind: 'super-admin' }))).toBe('Intelligence');
    expect(resolveIntelligenceLabel(makeBrand({ kind: 'tenant', agency: null }))).toBe('Intelligence');
  });
});
