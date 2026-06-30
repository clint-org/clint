import { describe, expect, it } from 'vitest';

import { MarkerAnchorFields, markerEditAnchor, markerEditRoute } from './marker-edit-route';

// Minimal anchor factory: only the fields the resolver reads matter.
function catalyst(over: Partial<MarkerAnchorFields>): MarkerAnchorFields {
  return {
    anchor_type: 'space',
    company_id: null,
    asset_id: null,
    trial_id: null,
    ...over,
  };
}

describe('markerEditAnchor', () => {
  it('resolves a trial-anchored marker to its trial profile', () => {
    expect(markerEditAnchor(catalyst({ anchor_type: 'trial', trial_id: 't1' }))).toEqual({
      anchorType: 'trial',
      anchorId: 't1',
    });
  });

  // The regression this fix targets: asset/product-anchored markers used to be
  // gated out by a trial_id-only check and showed no Edit affordance.
  it('resolves an asset-anchored marker to its asset profile', () => {
    expect(markerEditAnchor(catalyst({ anchor_type: 'asset', asset_id: 'a1' }))).toEqual({
      anchorType: 'asset',
      anchorId: 'a1',
    });
  });

  it('resolves a company-anchored marker to its company profile', () => {
    expect(markerEditAnchor(catalyst({ anchor_type: 'company', company_id: 'c1' }))).toEqual({
      anchorType: 'company',
      anchorId: 'c1',
    });
  });

  it('returns null for a space-anchored marker (no entity profile to edit on)', () => {
    expect(markerEditAnchor(catalyst({ anchor_type: 'space' }))).toBeNull();
  });

  it('returns null when the anchor id is missing', () => {
    expect(markerEditAnchor(catalyst({ anchor_type: 'asset', asset_id: null }))).toBeNull();
    expect(markerEditAnchor(null)).toBeNull();
    expect(markerEditAnchor(undefined)).toBeNull();
  });
});

describe('markerEditRoute', () => {
  it('builds the anchor profile route with the ?marker edit deep link', () => {
    const route = markerEditRoute({ anchorType: 'asset', anchorId: 'a1' }, 'm1', 'tenantX', 'spaceY');
    expect(route).toEqual({
      commands: ['/t', 'tenantX', 's', 'spaceY', 'profiles', 'assets', 'a1'],
      queryParams: { marker: 'm1' },
    });
  });

  it('maps each anchor type to its profile segment', () => {
    expect(markerEditRoute({ anchorType: 'company', anchorId: 'c1' }, 'm1', 't', 's')?.commands).toContain(
      'companies'
    );
    expect(markerEditRoute({ anchorType: 'trial', anchorId: 't1' }, 'm1', 't', 's')?.commands).toContain(
      'trials'
    );
  });

  it('returns null when anchor or tenant/space context is missing', () => {
    expect(markerEditRoute(null, 'm1', 't', 's')).toBeNull();
    expect(markerEditRoute({ anchorType: 'asset', anchorId: 'a1' }, 'm1', '', 's')).toBeNull();
    expect(markerEditRoute({ anchorType: 'asset', anchorId: 'a1' }, 'm1', 't', '')).toBeNull();
    expect(markerEditRoute({ anchorType: 'asset', anchorId: 'a1' }, '', 't', 's')).toBeNull();
  });
});
