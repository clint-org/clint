import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCtgovClient } from '../../ctgov-sync/ctgov-client';

beforeEach(() => {
  vi.restoreAllMocks();
});

function urlOf(call: unknown[]): string {
  const arg = call[0];
  if (typeof arg === 'string') return arg;
  if (arg instanceof URL) return arg.toString();
  if (arg instanceof Request) return arg.url;
  return String(arg);
}

function headersOf(call: unknown[]): Record<string, string> {
  const init = call[1] as RequestInit | undefined;
  const h = init?.headers ?? {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    return Object.fromEntries(h.map(([k, v]) => [k.toLowerCase(), v]));
  }
  return Object.fromEntries(
    Object.entries(h as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

describe('CtgovClient.fetchStudy', () => {
  it('GETs /api/v2/studies/{nct} and returns parsed JSON', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ protocolSection: { foo: 'bar' } }), { status: 200 }),
      );
    const client = createCtgovClient({ baseUrl: 'https://x' });
    const result = await client.fetchStudy('NCT01234567');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchSpy.mock.calls[0])).toBe('https://x/api/v2/studies/NCT01234567');
    expect(result).toEqual({ protocolSection: { foo: 'bar' } });
  });

  it('returns null on HTTP 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    expect(await client.fetchStudy('NCT99999999')).toBeNull();
  });

  it('throws on HTTP 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    await expect(client.fetchStudy('NCT01234567')).rejects.toThrow();
  });

  it('sends a User-Agent header', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    await client.fetchStudy('NCT01234567');
    const headers = headersOf(fetchSpy.mock.calls[0]);
    expect(headers['user-agent']).toBe('clint-worker/1.0');
  });
});

describe('CtgovClient.fetchSummariesBatch', () => {
  it('builds query.term=(NCT01+OR+NCT02) and fields=NCTId,LastUpdatePostDate (URL-encoded)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ studies: [] }), { status: 200 }),
    );
    const client = createCtgovClient({ baseUrl: 'https://x' });
    await client.fetchSummariesBatch(['NCT01', 'NCT02']);
    const url = urlOf(fetchSpy.mock.calls[0]);
    expect(url).toContain('query.term=(NCT01+OR+NCT02)');
    expect(url).toContain('fields=NCTId%2CLastUpdatePostDate');
  });

  it('sets pageSize equal to the input length', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ studies: [] }), { status: 200 }),
    );
    const client = createCtgovClient({ baseUrl: 'https://x' });
    await client.fetchSummariesBatch(['NCT01', 'NCT02', 'NCT03']);
    const url = urlOf(fetchSpy.mock.calls[0]);
    expect(url).toContain('pageSize=3');
  });

  it("parses CT.gov v2 response shape into [{nctId, lastUpdatePostDate}]", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          studies: [
            {
              protocolSection: {
                identificationModule: { nctId: 'NCT01' },
                statusModule: { lastUpdatePostDateStruct: { date: '2026-04-01' } },
              },
            },
            {
              protocolSection: {
                identificationModule: { nctId: 'NCT02' },
                statusModule: { lastUpdatePostDateStruct: { date: '2026-03-15' } },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = createCtgovClient({ baseUrl: 'https://x' });
    const result = await client.fetchSummariesBatch(['NCT01', 'NCT02']);
    expect(result).toEqual([
      { nctId: 'NCT01', lastUpdatePostDate: '2026-04-01' },
      { nctId: 'NCT02', lastUpdatePostDate: '2026-03-15' },
    ]);
  });

  it('skips entries missing nctId or lastUpdatePostDate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          studies: [
            {
              protocolSection: {
                identificationModule: { nctId: 'NCT01' },
                statusModule: { lastUpdatePostDateStruct: { date: '2026-04-01' } },
              },
            },
            // missing nctId
            {
              protocolSection: {
                identificationModule: {},
                statusModule: { lastUpdatePostDateStruct: { date: '2026-03-15' } },
              },
            },
            // missing date
            {
              protocolSection: {
                identificationModule: { nctId: 'NCT03' },
                statusModule: {},
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = createCtgovClient({ baseUrl: 'https://x' });
    const result = await client.fetchSummariesBatch(['NCT01', 'NCT02', 'NCT03']);
    expect(result).toEqual([{ nctId: 'NCT01', lastUpdatePostDate: '2026-04-01' }]);
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    await expect(client.fetchSummariesBatch(['NCT01'])).rejects.toThrow();
  });
});

describe('CtgovClient.fetchHistory (opportunistic)', () => {
  it('GETs /api/int/studies/{nct}/history and returns the changes array', async () => {
    const changes = [
      { version: 1, date: '2025-01-01', moduleLabels: ['IdentificationModule'] },
      { version: 2, date: '2026-04-01', moduleLabels: ['StatusModule'] },
    ];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ changes }), { status: 200 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    const result = await client.fetchHistory('NCT01234567');
    expect(urlOf(fetchSpy.mock.calls[0])).toBe('https://x/api/int/studies/NCT01234567/history');
    expect(result).toEqual(changes);
  });

  it('returns null on HTTP 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    expect(await client.fetchHistory('NCT99999999')).toBeNull();
  });

  it('returns null on parse error (non-JSON body)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 200 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    expect(await client.fetchHistory('NCT01234567')).toBeNull();
  });

  it('returns null on network error (fetch throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    expect(await client.fetchHistory('NCT01234567')).toBeNull();
  });
});
