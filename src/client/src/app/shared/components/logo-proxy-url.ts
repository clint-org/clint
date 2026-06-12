// Pure helper for routing a resolved logo URL through the same-origin worker
// image proxy (`/api/logo`). Kept free of Angular / window access so it can be
// unit-tested in the Node environment (see logo-proxy-url.spec.ts); callers
// pass the worker API base (window.__WORKER_API_BASE, '' for same-origin).
//
// Why proxy at all: third-party logo hosts break both export paths. The PNG
// export's DOM rasterizer (modern-screenshot) re-fetches each <img> and is
// blocked by CSP connect-src for non-allowlisted hosts; the canvas
// pre-rasterizer needs Access-Control-Allow-Origin, which self-hosted hosts
// (e.g. stout.com) do not send. A same-origin proxy URL satisfies connect-src
// 'self' and the worker re-emits the bytes with permissive CORS. See
// worker/logo-proxy.ts.

/**
 * Wraps an absolute http(s) logo URL so it loads via `${apiBase}/api/logo`.
 * Already-local (data:, blob:, relative, or same-origin) URLs and null pass
 * through untouched -- they need no proxying.
 */
export function proxyLogoUrl(
  resolved: string | null | undefined,
  apiBase: string
): string | null {
  if (!resolved) return null;
  if (!/^https?:\/\//i.test(resolved)) return resolved;
  return `${apiBase}/api/logo?url=${encodeURIComponent(resolved)}`;
}
