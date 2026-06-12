import { errorResponse } from './errors';

// Same-origin image proxy for brand logos. The app renders company / agency /
// tenant logos that live on third-party hosts (cdn.brandfetch.io, plus any
// self-hosted host an admin pastes in, e.g. stout.com). Loading those directly
// works for live <img> tags but breaks both export paths:
//
//   1. PNG export rasterizes the live DOM with modern-screenshot, which
//      re-fetches every <img> via fetch() to inline it. Third-party hosts are
//      not in the CSP connect-src allowlist, so the fetch is refused and the
//      logo rasterizes as a blank gap.
//   2. PPTX / footer export rasterizes logos through a canvas (crossOrigin),
//      which requires the host to send Access-Control-Allow-Origin. Self-hosted
//      logo hosts (stout.com) send none, tainting the canvas, so the logo is
//      dropped to a name-text fallback.
//
// Routing every logo through this same-origin endpoint fixes both at once: the
// export fetch is same-origin (connect-src 'self'), and we re-emit the bytes
// with Access-Control-Allow-Origin: * so the canvas stays clean. Responses are
// cached at the edge (caches.default) and in the browser, so the proxy adds at
// most one cheap edge hop on a logo's first-ever load.

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB: brand logos are KB-scale; cap abuse.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days; logos are effectively immutable.

// brandfetch's Logo Link CDN sniffs the User-Agent: a browser-like UA gets the
// real image, anything else (a bare Worker / curl fetch) is 302'd to their
// hotlinking-guidelines HTML page. We forward the caller's real browser UA, and
// fall back to a recent Chrome UA for any server-initiated call so the proxy
// works without a browser in the loop.
const BROWSER_UA_FALLBACK =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Hosts we must never proxy to. Workers have no reachable internal network or
// metadata endpoint, so SSRF surface is small, but we still refuse obvious
// loopback / link-local / private targets as defense in depth.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '[::1]') return true;
  // IPv4 literal in a private / loopback / link-local range.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 0) return true;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (h.startsWith('[fc') || h.startsWith('[fd') || h.startsWith('[fe8')) return true;
  return false;
}

function isImageContentType(contentType: string): boolean {
  return /^image\//i.test(contentType.trim());
}

/**
 * GET /api/logo?url=<https image url>
 *
 * Anon-callable: logos render before auth (login page, marketing landing) and
 * the export rasterizer cannot attach a JWT. Abuse is bounded by https-only +
 * public-host-only + image-content-type + 5 MB cap + aggressive caching.
 */
export async function handleLogoProxy(
  request: Request,
  cors: Record<string, string>,
  ctx?: { waitUntil(p: Promise<unknown>): void }
): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get('url');
  if (!target) {
    return errorResponse(400, 'url_required', cors);
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return errorResponse(400, 'invalid_url', cors);
  }
  if (parsed.protocol !== 'https:') {
    return errorResponse(400, 'invalid_scheme', cors);
  }
  if (isBlockedHost(parsed.hostname)) {
    return errorResponse(400, 'blocked_host', cors);
  }

  // Edge cache keyed by the normalized upstream URL (not the inbound request,
  // whose host varies across tenant subdomains -- a shared key maximizes hits).
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const cacheKey = new Request(`https://logo-proxy.internal/${encodeURIComponent(parsed.toString())}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': request.headers.get('User-Agent') ?? BROWSER_UA_FALLBACK,
      },
      // Let Cloudflare cache the subrequest too; cheap and survives cache.default eviction.
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    } as RequestInit);
  } catch {
    return errorResponse(502, 'upstream_unreachable', cors);
  }

  if (!upstream.ok) {
    return errorResponse(502, 'upstream_error', cors);
  }

  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (!isImageContentType(contentType)) {
    return errorResponse(415, 'not_an_image', cors);
  }

  const declaredLen = Number(upstream.headers.get('Content-Length') ?? '0');
  if (declaredLen && declaredLen > MAX_BYTES) {
    return errorResponse(413, 'too_large', cors);
  }

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return errorResponse(413, 'too_large', cors);
  }

  const response = new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Canvas pre-rasterization (crossOrigin=anonymous) needs this to stay clean.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      // Neutralize script in a proxied SVG if it is ever opened top-level: the
      // bytes are served from our origin, so without this an image/svg+xml
      // payload could run script in our context. <img> rendering is unaffected.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });

  if (cache) {
    const store = cache.put(cacheKey, response.clone());
    if (ctx) ctx.waitUntil(store);
    else await store;
  }

  return response;
}
