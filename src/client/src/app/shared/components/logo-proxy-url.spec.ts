import { describe, expect, it } from 'vitest';

import { proxyLogoUrl } from './logo-proxy-url';

describe('proxyLogoUrl', () => {
  it('returns null for empty input', () => {
    expect(proxyLogoUrl(null, '')).toBeNull();
    expect(proxyLogoUrl(undefined, '')).toBeNull();
    expect(proxyLogoUrl('', '')).toBeNull();
  });

  it('routes an absolute https logo through the same-origin proxy', () => {
    const url = 'https://cdn.brandfetch.io/lilly.com/icon/fallback/lettermark?c=cid';
    expect(proxyLogoUrl(url, '')).toBe(`/api/logo?url=${encodeURIComponent(url)}`);
  });

  it('prefixes the configured worker api base', () => {
    const url = 'https://www.stout.com/media/stout_logo.svg';
    expect(proxyLogoUrl(url, 'https://dev.clintapp.com')).toBe(
      `https://dev.clintapp.com/api/logo?url=${encodeURIComponent(url)}`
    );
  });

  it('encodes the upstream url so its query string survives intact', () => {
    const url = 'https://cdn.brandfetch.io/x/icon?c=a&v=2';
    const out = proxyLogoUrl(url, '');
    expect(out).toContain(encodeURIComponent(url));
    // The upstream ? and & must be encoded, not bleed into the proxy query.
    expect(out!.indexOf('?')).toBe(out!.lastIndexOf('?'));
  });

  it('passes data:, blob:, and relative URLs through untouched', () => {
    expect(proxyLogoUrl('data:image/png;base64,AAAA', '')).toBe('data:image/png;base64,AAAA');
    expect(proxyLogoUrl('blob:https://x/abc', '')).toBe('blob:https://x/abc');
    expect(proxyLogoUrl('/assets/logo.svg', '')).toBe('/assets/logo.svg');
  });
});
