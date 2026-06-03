import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichCompanyLogos } from '../../source-extract/logo-enrichment';

const CLIENT_ID = '1idkTE42LH-0X2u_ymo';
const REFERER = 'https://dev.clintapp.com/';
const PLACEHOLDER_ETAG = '"50d0-2qeW7LHRdpFgBCxSKMv6Q0bjCeY"';

function probeResponse(opts: { ok: boolean; etag?: string | null }): Response {
  const headers = new Headers();
  if (opts.etag) headers.set('etag', opts.etag);
  return new Response(null, { status: opts.ok ? 206 : 404, headers });
}

describe('enrichCompanyLogos', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty when companies list is empty', async () => {
    const result = await enrichCompanyLogos([], CLIENT_ID, REFERER);
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty when client id is missing', async () => {
    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme', website: 'acme.com' }],
      '',
      REFERER
    );
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty when referer is missing', async () => {
    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme', website: 'acme.com' }],
      CLIENT_ID,
      ''
    );
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('picks symbol when its etag is not the placeholder', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/symbol')) {
        return Promise.resolve(probeResponse({ ok: true, etag: '"abc-real-symbol"' }));
      }
      return Promise.resolve(probeResponse({ ok: true, etag: '"def-real-other"' }));
    });

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Boehringer Ingelheim', website: 'boehringer-ingelheim.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(result[0]).toBe('https://cdn.brandfetch.io/boehringer-ingelheim.com/symbol');
  });

  it('falls through to icon when symbol etag matches the placeholder', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/symbol')) {
        return Promise.resolve(probeResponse({ ok: true, etag: PLACEHOLDER_ETAG }));
      }
      if (url.includes('/icon')) {
        return Promise.resolve(probeResponse({ ok: true, etag: '"abc-real-icon"' }));
      }
      return Promise.resolve(probeResponse({ ok: true, etag: '"def-real-logo"' }));
    });

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Lilly', website: 'lilly.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(result[0]).toBe('https://cdn.brandfetch.io/lilly.com/icon');
  });

  it('falls all the way through to logo when symbol and icon are placeholders', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/logo')) {
        return Promise.resolve(probeResponse({ ok: true, etag: '"abc-real-logo"' }));
      }
      return Promise.resolve(probeResponse({ ok: true, etag: PLACEHOLDER_ETAG }));
    });

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme', website: 'acme.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(result[0]).toBe('https://cdn.brandfetch.io/acme.com/logo');
  });

  it('omits companies where every type is the placeholder', async () => {
    fetchMock.mockResolvedValue(probeResponse({ ok: true, etag: PLACEHOLDER_ETAG }));

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Unknown Co', website: 'unknown.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(result).toEqual({});
  });

  it('omits companies where every type returns non-OK', async () => {
    fetchMock.mockResolvedValue(probeResponse({ ok: false }));

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Unknown Co', website: 'unknown.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(result).toEqual({});
  });

  it('omits companies whose CDN probe rejects on network', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme', website: 'acme.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(result).toEqual({});
  });

  it('strips www. before probing the CDN', async () => {
    let receivedUrl = '';
    fetchMock.mockImplementation((url: string) => {
      receivedUrl = url;
      return Promise.resolve(probeResponse({ ok: true, etag: PLACEHOLDER_ETAG }));
    });

    await enrichCompanyLogos(
      [{ index: 0, name: 'Novo Nordisk', website: 'https://www.novonordisk.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(receivedUrl).toContain('/novonordisk.com/');
    expect(receivedUrl).not.toContain('www.');
  });

  it('sends browser-like headers so the CDN hotlink check passes', async () => {
    let receivedInit: RequestInit | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      receivedInit = init;
      return Promise.resolve(probeResponse({ ok: true, etag: '"abc-real"' }));
    });

    await enrichCompanyLogos(
      [{ index: 0, name: 'Boehringer Ingelheim', website: 'boehringer-ingelheim.com' }],
      CLIENT_ID,
      REFERER
    );

    expect(receivedInit?.method).toBe('GET');
    const headers = receivedInit?.headers as Record<string, string>;
    expect(headers['Referer']).toBe(REFERER);
    expect(headers['Origin']).toBe('https://dev.clintapp.com');
    expect(headers['Range']).toBe('bytes=0-0');
  });

  it('derives domain from name when website is missing', async () => {
    let receivedUrl = '';
    fetchMock.mockImplementation((url: string) => {
      receivedUrl = url;
      return Promise.resolve(probeResponse({ ok: true, etag: '"abc-real"' }));
    });

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme Pharma', website: null }],
      CLIENT_ID,
      REFERER
    );

    expect(receivedUrl).toContain('/acme.com/');
    expect(result[0]).toBe('https://cdn.brandfetch.io/acme.com/symbol');
  });
});
