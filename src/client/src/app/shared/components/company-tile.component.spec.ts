import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Contract tests for issue #194: company logo tiles rendered the raw stored
// Brandfetch URL directly (`[ngSrc]="logoUrl()"`). Without the client id +
// lettermark that `resolveBrandLogoSrc` appends, Brandfetch's CDN serves its
// blank hotlink-protection placeholder for gated brands, leaving the tile
// empty (observed for Arrowhead and Biogen). The fix routes every company
// logo through `app-brand-logo`, which owns the resolve + `/api/logo` proxy +
// (error) fallback. These assertions guard against a regression back to raw
// rendering. Units cannot TestBed-render these components, so we assert on the
// template source the same way the intelligence-stack contract test does.
const dir = join(__dirname);
const tileSrc = readFileSync(join(dir, 'company-tile.component.ts'), 'utf8');
const markerDetailSrc = readFileSync(join(dir, 'marker-detail-content.component.ts'), 'utf8');

describe('CompanyTileComponent logo resolution contract (#194)', () => {
  it('delegates the logo to app-brand-logo rather than an <img>', () => {
    expect(tileSrc).toContain('app-brand-logo');
    expect(tileSrc).toContain('[url]="logoUrl()"');
  });

  it('never hotlinks the raw stored URL (no ngSrc on the tile logo)', () => {
    expect(tileSrc).not.toContain('ngSrc');
    expect(tileSrc).not.toContain('NgOptimizedImage');
  });

  it('keeps the deterministic initial-square as the projected fallback', () => {
    // The initials tile is what app-brand-logo shows when the url is null or
    // the resolved logo fails to load.
    expect(tileSrc).toContain('{{ initial() }}');
    expect(tileSrc).toContain('background()');
  });
});

describe('MarkerDetailContent company logo contract (#194)', () => {
  it('routes the catalyst company logo through app-brand-logo', () => {
    expect(markerDetailSrc).toContain('app-brand-logo');
    expect(markerDetailSrc).toContain('[url]="d.catalyst.company_logo_url"');
  });

  it('no longer renders the raw company logo URL via ngSrc', () => {
    expect(markerDetailSrc).not.toContain('[ngSrc]="d.catalyst.company_logo_url"');
  });

  it('keeps the building-icon fallback for companies with no logo', () => {
    expect(markerDetailSrc).toContain('fa-building');
  });
});
