import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLogoProxy } from '../logo-proxy';

const CORS = { 'Access-Control-Allow-Origin': 'https://pfizer.clintapp.com' };

// A 1x1 transparent PNG.
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);

function imageResponse(contentType = 'image/png', extraHeaders: Record<string, string> = {}): Response {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: { 'Content-Type': contentType, ...extraHeaders },
  });
}

function proxyRequest(target: string | null): Request {
  const u = new URL('https://pfizer.clintapp.com/api/logo');
  if (target !== null) u.searchParams.set('url', target);
  return new Request(u.toString(), { method: 'GET' });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleLogoProxy validation', () => {
  it('400 when url param is missing', async () => {
    const res = await handleLogoProxy(proxyRequest(null), CORS);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('url_required');
  });

  it('400 on an unparseable url', async () => {
    const res = await handleLogoProxy(proxyRequest('not a url'), CORS);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('invalid_url');
  });

  it('400 on a non-https scheme', async () => {
    const res = await handleLogoProxy(proxyRequest('http://cdn.brandfetch.io/x/icon'), CORS);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('invalid_scheme');
  });

  it('400 on a blocked private host', async () => {
    for (const host of [
      'https://localhost/logo.png',
      'https://127.0.0.1/logo.png',
      'https://10.0.0.5/logo.png',
      'https://192.168.1.1/logo.png',
      'https://169.254.169.254/latest/meta-data',
      'https://foo.internal/logo.png',
    ]) {
      const res = await handleLogoProxy(proxyRequest(host), CORS);
      expect(res.status, host).toBe(400);
      expect(await errorOf(res), host).toBe('blocked_host');
    }
  });
});

describe('handleLogoProxy fetch + re-emit', () => {
  it('proxies an image with CORS + cache headers and image bytes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
    const target = 'https://cdn.brandfetch.io/pfizer.com/icon/fallback/lettermark?c=abc';
    const res = await handleLogoProxy(proxyRequest(target), CORS);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toContain('max-age=');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(PNG_BYTES.byteLength);
    // Upstream was fetched with the normalized target.
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect((fetchSpy.mock.calls[0][0] as string)).toContain('cdn.brandfetch.io/pfizer.com');
  });

  it('forwards a browser User-Agent so brandfetch serves the image instead of its guidelines page', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
    // Inbound browser UA must be forwarded verbatim to the upstream.
    const req = new Request(
      'https://pfizer.clintapp.com/api/logo?url=' +
        encodeURIComponent('https://cdn.brandfetch.io/ua-test.com/icon?c=abc'),
      { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 TestBrowser/9' } }
    );
    await handleLogoProxy(req, CORS);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('Mozilla/5.0 TestBrowser/9');
  });

  it('falls back to a browser User-Agent when the caller sends none', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
    await handleLogoProxy(proxyRequest('https://cdn.brandfetch.io/no-ua.com/icon?c=abc'), CORS);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/Mozilla\/5\.0.*Chrome/);
  });

  it('415 when upstream returns a non-image content type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>not an image</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const res = await handleLogoProxy(proxyRequest('https://evil.example/page'), CORS);
    expect(res.status).toBe(415);
    expect(await errorOf(res)).toBe('not_an_image');
  });

  it('413 when upstream declares a Content-Length over the cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      imageResponse('image/png', { 'Content-Length': String(6 * 1024 * 1024) })
    );
    const res = await handleLogoProxy(proxyRequest('https://cdn.brandfetch.io/x/icon'), CORS);
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toBe('too_large');
  });

  it('502 when the upstream fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await handleLogoProxy(proxyRequest('https://cdn.brandfetch.io/x/icon'), CORS);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe('upstream_unreachable');
  });

  it('502 when the upstream returns a non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    const res = await handleLogoProxy(proxyRequest('https://cdn.brandfetch.io/x/icon'), CORS);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe('upstream_error');
  });

  it('serves a second identical request from the edge cache (one upstream fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
    // Unique URL so this test does not collide with cache entries from others.
    const target = 'https://cdn.brandfetch.io/cache-test.com/icon/fallback/lettermark?c=xyz';
    const first = await handleLogoProxy(proxyRequest(target), CORS);
    expect(first.status).toBe(200);
    const second = await handleLogoProxy(proxyRequest(target), CORS);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer()).byteLength).toBe(PNG_BYTES.byteLength);
    // The cache hit means upstream was only contacted once.
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
