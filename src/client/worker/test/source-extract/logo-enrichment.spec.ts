import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichCompanyLogos, pickAvailableType } from '../../source-extract/logo-enrichment';

const API_KEY = 'test-key';

function brandResponse(logos: { type: string; theme?: string }[]): Response {
  return new Response(JSON.stringify({ logos }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('pickAvailableType', () => {
  it('prefers symbol over icon and logo', () => {
    expect(
      pickAvailableType([
        { type: 'logo', theme: 'light' },
        { type: 'symbol', theme: 'light' },
        { type: 'icon', theme: 'light' },
      ])
    ).toBe('symbol');
  });

  it('falls back to icon when symbol is missing', () => {
    expect(
      pickAvailableType([
        { type: 'icon', theme: 'light' },
        { type: 'logo', theme: 'light' },
      ])
    ).toBe('icon');
  });

  it('ignores dark-theme assets', () => {
    expect(
      pickAvailableType([
        { type: 'symbol', theme: 'dark' },
        { type: 'icon', theme: 'light' },
      ])
    ).toBe('icon');
  });

  it('returns null when none of symbol/icon/logo are present', () => {
    expect(pickAvailableType([{ type: 'other', theme: 'light' }])).toBeNull();
    expect(pickAvailableType([])).toBeNull();
  });
});

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
    const result = await enrichCompanyLogos([], API_KEY);
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty when api key is missing', async () => {
    const result = await enrichCompanyLogos([{ index: 0, name: 'Acme', website: 'acme.com' }], '');
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores typed URL with the best available type per company', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('lilly.com')) {
        return Promise.resolve(
          brandResponse([
            { type: 'icon', theme: 'light' },
            { type: 'logo', theme: 'light' },
          ])
        );
      }
      if (url.includes('boehringer-ingelheim.com')) {
        return Promise.resolve(
          brandResponse([
            { type: 'symbol', theme: 'light' },
            { type: 'logo', theme: 'light' },
          ])
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    const result = await enrichCompanyLogos(
      [
        { index: 0, name: 'Lilly', website: 'lilly.com' },
        { index: 1, name: 'Boehringer Ingelheim', website: 'boehringer-ingelheim.com' },
      ],
      API_KEY
    );

    expect(result[0]).toBe('https://cdn.brandfetch.io/lilly.com/icon');
    expect(result[1]).toBe('https://cdn.brandfetch.io/boehringer-ingelheim.com/symbol');
  });

  it('omits companies whose Brand API call returns non-OK', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Unknown Co', website: 'unknown-co.com' }],
      API_KEY
    );

    expect(result).toEqual({});
  });

  it('omits companies whose Brand API call rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme', website: 'acme.com' }],
      API_KEY
    );

    expect(result).toEqual({});
  });

  it('omits companies that report only dark-theme or unsupported assets', async () => {
    fetchMock.mockResolvedValue(
      brandResponse([
        { type: 'symbol', theme: 'dark' },
        { type: 'other', theme: 'light' },
      ])
    );

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme', website: 'acme.com' }],
      API_KEY
    );

    expect(result).toEqual({});
  });

  it('strips www. before calling the Brand API', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/novonordisk.com')) {
        return Promise.resolve(brandResponse([{ type: 'icon', theme: 'light' }]));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Novo Nordisk', website: 'https://www.novonordisk.com' }],
      API_KEY
    );

    expect(result[0]).toBe('https://cdn.brandfetch.io/novonordisk.com/icon');
  });

  it('derives domain from name when website is missing', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('acme.com')) {
        return Promise.resolve(brandResponse([{ type: 'logo', theme: 'light' }]));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    const result = await enrichCompanyLogos(
      [{ index: 0, name: 'Acme Pharma', website: null }],
      API_KEY
    );

    expect(result[0]).toBe('https://cdn.brandfetch.io/acme.com/logo');
  });
});
