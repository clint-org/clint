import { environment } from '../../../environments/environment';
import { resolveBrandLogoSrc } from '../../shared/components/brand-logo-url';
import { proxyLogoUrl } from '../../shared/components/logo-proxy-url';

const LOAD_TIMEOUT_MS = 8000;

/**
 * Load a logo URL as an image element for canvas use. Brandfetch URLs are
 * enriched the same way the app renders them. Resolves null on any failure
 * (404, cross-origin block, timeout) so callers can simply omit the logo.
 */
export function loadImageElement(rawUrl: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!rawUrl) return Promise.resolve(null);
  // Route through the same-origin worker proxy: it re-emits the bytes with
  // Access-Control-Allow-Origin: *, so the canvas stays untainted even for
  // self-hosted logo hosts (e.g. stout.com) that send no CORS headers. See
  // worker/logo-proxy.ts.
  const resolved = resolveBrandLogoSrc(rawUrl, environment.brandfetchClientId) ?? rawUrl;
  const apiBase = (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE ?? '';
  const url = proxyLogoUrl(resolved, apiBase) ?? resolved;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (v: HTMLImageElement | null): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => {
      img.src = ''; // cancel the in-flight request
      finish(null);
    }, LOAD_TIMEOUT_MS);
    img.onload = (): void => {
      clearTimeout(timer);
      finish(img);
    };
    img.onerror = (): void => {
      clearTimeout(timer);
      finish(null);
    };
    img.src = url;
  });
}

/**
 * Loads a logo URL and returns a base64 PNG data URI. Rasterizing through a
 * canvas converts SVG / webp to PNG and, because loadImageElement requests
 * the image with crossOrigin=anonymous, guarantees the result is safe to
 * embed anywhere (pptxgenjs addImage, the PNG export's DOM capture). Returns
 * null on any failure (404, CORS block, tainted canvas, timeout) so callers
 * fall back to name text instead of an empty logo slot.
 */
export async function logoToPngDataUrl(rawUrl: string | null | undefined): Promise<string | null> {
  const img = await loadImageElement(rawUrl);
  if (!img) return null;
  try {
    const w = img.naturalWidth || 256;
    const h = img.naturalHeight || 256;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
