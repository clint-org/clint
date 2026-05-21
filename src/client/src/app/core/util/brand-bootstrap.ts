import type { Brand } from '../models/brand.model';
import { DEFAULT_BRAND } from '../services/brand-context.service';

export const BRAND_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedBrand {
  brand: Brand;
  fetchedAt: number;
}

function cacheKey(host: string): string {
  return `brand:${host}`;
}

export function readBrandCache(host: string): Brand | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(host));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBrand;
    if (!parsed?.brand || typeof parsed.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > BRAND_CACHE_TTL_MS) return null;
    return parsed.brand;
  } catch {
    return null;
  }
}

export function writeBrandCache(host: string, brand: Brand): void {
  try {
    const payload: CachedBrand = { brand, fetchedAt: Date.now() };
    sessionStorage.setItem(cacheKey(host), JSON.stringify(payload));
  } catch {
    // Quota or disabled storage. Silent fallback to network.
  }
}

export function clearBrandCache(host: string): void {
  try {
    sessionStorage.removeItem(cacheKey(host));
  } catch {
    // ignore
  }
}

export async function fetchBrandWithCache(
  host: string,
  fetchFromNetwork: () => Promise<Brand | null>
): Promise<Brand> {
  const cached = readBrandCache(host);
  if (cached) return cached;

  const fresh = await fetchFromNetwork();
  if (!fresh) return DEFAULT_BRAND;

  writeBrandCache(host, fresh);
  return fresh;
}
