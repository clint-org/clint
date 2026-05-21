import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Brand } from '../models/brand.model';
import { readBrandCache, writeBrandCache, BRAND_CACHE_TTL_MS } from './brand-bootstrap';

describe('brand-bootstrap', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { sessionStorage: Storage }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    };
  });

  it('returns null when nothing is cached', () => {
    expect(readBrandCache('example.com')).toBeNull();
  });

  it('returns the cached brand within TTL', () => {
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as Brand);
    expect(readBrandCache('example.com')?.app_display_name).toBe('X');
  });

  it('returns null when the cache is older than TTL', () => {
    vi.useFakeTimers();
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as Brand);
    vi.advanceTimersByTime(BRAND_CACHE_TTL_MS + 1);
    expect(readBrandCache('example.com')).toBeNull();
    vi.useRealTimers();
  });

  it('returns null when the cached payload is malformed', () => {
    sessionStorage.setItem('brand:example.com', 'not-json');
    expect(readBrandCache('example.com')).toBeNull();
  });
});
