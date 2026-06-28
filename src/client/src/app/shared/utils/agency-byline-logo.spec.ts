import { describe, expect, it } from 'vitest';

import { Brand } from '../../core/models/brand.model';
import { agencyLogoFromBrand } from './agency-byline-logo';

function brand(over: Partial<Brand>): Brand {
  return {
    kind: 'tenant',
    id: 'b1',
    app_display_name: 'Acme Pharma',
    logo_url: null,
    favicon_url: null,
    primary_color: '#0d9488',
    auth_providers: ['google'],
    has_self_join: false,
    suspended: false,
    agency: null,
    ...over,
  };
}

describe('agencyLogoFromBrand', () => {
  it('returns the parent agency logo on a tenant host', () => {
    const b = brand({ kind: 'tenant', agency: { name: 'Stout Strategy', logo_url: 'https://cdn/stout.png' } });
    expect(agencyLogoFromBrand(b)).toBe('https://cdn/stout.png');
  });

  it('returns null on a tenant host whose agency has no logo (falls back to initials)', () => {
    const b = brand({ kind: 'tenant', agency: { name: 'Stout Strategy', logo_url: null } });
    expect(agencyLogoFromBrand(b)).toBeNull();
  });

  it('returns null on a tenant host with no parent agency', () => {
    expect(agencyLogoFromBrand(brand({ kind: 'tenant', agency: null }))).toBeNull();
  });

  it("uses the brand's own logo on an agency host (the brand is the agency)", () => {
    const b = brand({ kind: 'agency', logo_url: 'https://cdn/agency-host.png', agency: null });
    expect(agencyLogoFromBrand(b)).toBe('https://cdn/agency-host.png');
  });

  it('returns null for default / super-admin brands', () => {
    expect(agencyLogoFromBrand(brand({ kind: 'default' }))).toBeNull();
    expect(agencyLogoFromBrand(brand({ kind: 'super-admin' }))).toBeNull();
  });
});
