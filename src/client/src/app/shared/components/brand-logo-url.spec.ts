import { describe, expect, it } from 'vitest';

import { resolveBrandLogoSrc } from './brand-logo-url';

const CID = 'test-client-id';

describe('resolveBrandLogoSrc', () => {
  it('returns null for empty input so the component renders its fallback', () => {
    expect(resolveBrandLogoSrc(null, CID)).toBeNull();
    expect(resolveBrandLogoSrc(undefined, CID)).toBeNull();
    expect(resolveBrandLogoSrc('', CID)).toBeNull();
  });

  it('passes non-Brandfetch URLs through untouched', () => {
    const url = 'https://example.com/logos/acme.png';
    expect(resolveBrandLogoSrc(url, CID)).toBe(url);
  });

  it('appends the client id and lettermark fallback to a bare-domain URL', () => {
    expect(resolveBrandLogoSrc('https://cdn.brandfetch.io/lilly.com', CID)).toBe(
      `https://cdn.brandfetch.io/lilly.com/icon/fallback/lettermark?c=${CID}`
    );
  });

  it('preserves the stored asset type', () => {
    expect(resolveBrandLogoSrc('https://cdn.brandfetch.io/lilly.com/symbol', CID)).toBe(
      `https://cdn.brandfetch.io/lilly.com/symbol/fallback/lettermark?c=${CID}`
    );
    expect(resolveBrandLogoSrc('https://cdn.brandfetch.io/lilly.com/logo', CID)).toBe(
      `https://cdn.brandfetch.io/lilly.com/logo/fallback/lettermark?c=${CID}`
    );
  });

  it('is idempotent: re-resolving an already-resolved URL is stable', () => {
    const once = resolveBrandLogoSrc('https://cdn.brandfetch.io/lilly.com/icon', CID);
    expect(resolveBrandLogoSrc(once, CID)).toBe(once);
  });

  it('strips an existing query string before re-appending the client id', () => {
    expect(resolveBrandLogoSrc('https://cdn.brandfetch.io/lilly.com/icon?c=old', CID)).toBe(
      `https://cdn.brandfetch.io/lilly.com/icon/fallback/lettermark?c=${CID}`
    );
  });

  it('tolerates the legacy /domain/<domain> seed shape', () => {
    expect(resolveBrandLogoSrc('https://cdn.brandfetch.io/domain/lilly.com', CID)).toBe(
      `https://cdn.brandfetch.io/lilly.com/icon/fallback/lettermark?c=${CID}`
    );
  });

  it('omits the client id query when none is configured', () => {
    expect(resolveBrandLogoSrc('https://cdn.brandfetch.io/lilly.com/icon', undefined)).toBe(
      'https://cdn.brandfetch.io/lilly.com/icon/fallback/lettermark'
    );
  });
});
