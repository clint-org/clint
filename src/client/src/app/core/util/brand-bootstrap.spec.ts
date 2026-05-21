import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Brand } from '../models/brand.model';
import {
  readBrandCache,
  writeBrandCache,
  clearBrandCache,
  fetchBrandWithCache,
  broadcastBrandInvalidation,
  installBrandInvalidationListener,
  BRAND_CACHE_TTL_MS,
} from './brand-bootstrap';
import { DEFAULT_BRAND } from '../services/brand-context.service';

function makeSessionStorageMock(): Partial<Storage> {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

describe('brand-bootstrap', () => {
  beforeEach(() => {
    (globalThis as { sessionStorage: Partial<Storage> }).sessionStorage = makeSessionStorageMock();
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

describe('writeBrandCache key format', () => {
  beforeEach(() => {
    (globalThis as { sessionStorage: Partial<Storage> }).sessionStorage = makeSessionStorageMock();
  });

  it('stores under sessionStorage key "brand:<host>"', () => {
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as Brand);
    expect(sessionStorage.getItem('brand:example.com')).not.toBeNull();
  });
});

describe('clearBrandCache', () => {
  beforeEach(() => {
    (globalThis as { sessionStorage: Partial<Storage> }).sessionStorage = makeSessionStorageMock();
  });

  it('removes the entry', () => {
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as Brand);
    clearBrandCache('example.com');
    expect(readBrandCache('example.com')).toBeNull();
  });
});

describe('fetchBrandWithCache', () => {
  beforeEach(() => {
    (globalThis as { sessionStorage: Partial<Storage> }).sessionStorage = makeSessionStorageMock();
  });

  it('returns cached value without calling the network fn when cache is fresh', async () => {
    const cached = { app_display_name: 'cached', primary_color: '#000' } as Brand;
    writeBrandCache('example.com', cached);
    const networkFn = vi.fn();
    const result = await fetchBrandWithCache('example.com', networkFn);
    expect(result.app_display_name).toBe('cached');
    expect(networkFn).not.toHaveBeenCalled();
  });

  it('falls back to DEFAULT_BRAND when the network fn returns null', async () => {
    const result = await fetchBrandWithCache('example.com', async () => null);
    expect(result).toBe(DEFAULT_BRAND);
  });

  it('writes cache and returns fresh brand when network returns a value', async () => {
    const fresh = { app_display_name: 'fresh', primary_color: '#fff' } as Brand;
    const result = await fetchBrandWithCache('example.com', async () => fresh);
    expect(result.app_display_name).toBe('fresh');
    expect(readBrandCache('example.com')?.app_display_name).toBe('fresh');
  });
});

describe('brand-bootstrap cross-tab clear', () => {
  it('broadcastBrandInvalidation posts a message when BroadcastChannel is present', () => {
    const posts: unknown[] = [];
    (globalThis as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel = class {
      constructor(public name: string) {}
      postMessage(msg: unknown) { posts.push({ name: this.name, msg }); }
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      close() {}
    } as unknown as typeof BroadcastChannel;
    broadcastBrandInvalidation('example.com');
    expect(posts).toEqual([{ name: 'rpc-cache', msg: { type: 'brand-invalidate', host: 'example.com' } }]);
  });
});

describe('installBrandInvalidationListener', () => {
  let installed: ((e: { data: unknown }) => void)[];
  let store: Map<string, string>;

  beforeEach(() => {
    installed = [];
    store = new Map<string, string>();
    (globalThis as { sessionStorage: Storage }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      length: 0,
      key: () => null,
    };
    (globalThis as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel = class {
      constructor(public name: string) {}
      addEventListener(_type: string, fn: (e: { data: unknown }) => void) {
        installed.push(fn);
      }
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      postMessage() {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      close() {}
    } as unknown as typeof BroadcastChannel;
  });

  it('clears the brand cache when a brand-invalidate message arrives', () => {
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as Brand);
    installBrandInvalidationListener();
    installed[0]({ data: { type: 'brand-invalidate', host: 'example.com' } });
    expect(readBrandCache('example.com')).toBeNull();
  });

  it('ignores messages with the wrong type', () => {
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as Brand);
    installBrandInvalidationListener();
    installed[0]({ data: { type: 'something-else', host: 'example.com' } });
    expect(readBrandCache('example.com')?.app_display_name).toBe('X');
  });
});
