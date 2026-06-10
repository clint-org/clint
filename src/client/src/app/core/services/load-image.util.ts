import { environment } from '../../../environments/environment';
import { resolveBrandLogoSrc } from '../../shared/components/brand-logo-url';

const LOAD_TIMEOUT_MS = 8000;

/**
 * Load a logo URL as an image element for canvas use. Brandfetch URLs are
 * enriched the same way the app renders them. Resolves null on any failure
 * (404, cross-origin block, timeout) so callers can simply omit the logo.
 */
export function loadImageElement(rawUrl: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!rawUrl) return Promise.resolve(null);
  const url = resolveBrandLogoSrc(rawUrl, environment.brandfetchClientId) ?? rawUrl;
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
