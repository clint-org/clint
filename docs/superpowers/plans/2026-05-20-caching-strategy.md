# Caching Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate repeat client-side fetches within a user session, bound cross-user staleness with explicit TTLs, and make page navigation feel instant. Implements the V1 caching strategy in `docs/superpowers/specs/2026-05-14-caching-strategy-design.md`.

**Architecture:** Three layers. L0 sets `Cache-Control` headers on static assets via Cloudflare `_headers`. L1 caches `get_brand_by_host` in `sessionStorage` from `main.ts`. L2 is `RpcCache`, an in-memory singleton with stale-while-revalidate, inflight dedup, tag invalidation, BroadcastChannel cross-tab signaling, refresh-on-focus, and an equality-skip-before-emit contract.

**Tech Stack:** Angular 21 (signals, standalone components, `inject()`), `@supabase/supabase-js`, vitest for unit tests, Cloudflare Workers + `_headers`.

---

## File structure

**Create:**
- `src/client/src/app/core/services/rpc-cache.service.ts` — RpcCache singleton, ~250 lines
- `src/client/src/app/core/services/rpc-cache.spec.ts` — vitest spec for cache
- `src/client/src/app/core/util/stable-stringify.ts` — pure key normalization
- `src/client/src/app/core/util/stable-stringify.spec.ts` — vitest spec
- `src/client/src/app/core/util/brand-bootstrap.ts` — extracted `fetchBrand` with sessionStorage cache
- `src/client/src/app/core/util/brand-bootstrap.spec.ts` — vitest spec

**Modify:**
- `src/client/public/_headers` — add `Cache-Control` rules
- `src/client/src/main.ts` — call `fetchBrand` from `brand-bootstrap.ts`
- `src/client/src/app/core/services/tenant.service.ts` — clear brand cache on branding update
- `src/client/src/app/core/services/agency.service.ts` — clear brand cache on branding update
- `src/client/src/app/core/services/company.service.ts` — route through RpcCache
- `src/client/src/app/core/services/product.service.ts` — route through RpcCache (if it exists; else use the relevant LATERAL-joined call site)
- `src/client/src/app/core/services/therapeutic-area.service.ts` — route through RpcCache
- `src/client/src/app/core/services/mechanism-of-action.service.ts` — route through RpcCache
- `src/client/src/app/core/services/route-of-administration.service.ts` — route through RpcCache
- `src/client/src/app/core/services/marker-type.service.ts` — route through RpcCache
- `src/client/src/app/core/services/marker-category.service.ts` — route through RpcCache
- `src/client/src/app/core/services/event-category.service.ts` — route through RpcCache
- `src/client/src/app/core/services/dashboard.service.ts` — route through RpcCache
- `src/client/src/app/core/services/change-event.service.ts` — route through RpcCache (`get_activity_feed`)
- `src/client/src/app/core/services/primary-intelligence.service.ts` — route through RpcCache
- `src/client/src/app/core/services/space.service.ts` — route through RpcCache (`get_space_landing_stats`)
- `src/client/src/app/core/services/trial.service.ts` — route through RpcCache (`get_trial_detail_with_intelligence`)
- `src/client/src/app/core/services/material.service.ts` — route through RpcCache (3 list methods)

---

## Phase 1: L0 + L1 (static asset headers and sessionStorage brand cache)

### Task 1: Add `Cache-Control` rules for static assets

**Files:**
- Modify: `src/client/public/_headers`

- [ ] **Step 1: Append cache rules to `_headers`**

Open `src/client/public/_headers` and append the following block at the end of the file (after the existing CSP block):

```
/index.html
  Cache-Control: no-cache

/*.html
  Cache-Control: no-cache

/*.js
  Cache-Control: public, max-age=31536000, immutable

/*.css
  Cache-Control: public, max-age=31536000, immutable

/*.woff2
  Cache-Control: public, max-age=31536000, immutable

/favicon.svg
  Cache-Control: public, max-age=86400
```

- [ ] **Step 2: Build and verify the file is included**

Run: `cd src/client && ng build`
Expected: build succeeds. `dist/clinical-trial-dashboard/browser/_headers` exists and contains the rules.

Run: `cat dist/clinical-trial-dashboard/browser/_headers | tail -20`
Expected: shows the appended cache rules.

- [ ] **Step 3: Commit**

```bash
git add src/client/public/_headers
git commit -m "feat(caching): add Cache-Control rules for static assets"
```

---

### Task 2: Extract `fetchBrand` into a testable module with `sessionStorage` caching

**Files:**
- Create: `src/client/src/app/core/util/brand-bootstrap.ts`
- Create: `src/client/src/app/core/util/brand-bootstrap.spec.ts`
- Modify: `src/client/src/main.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/core/util/brand-bootstrap.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readBrandCache, writeBrandCache, BRAND_CACHE_TTL_MS } from './brand-bootstrap';

describe('brand-bootstrap', () => {
  beforeEach(() => {
    // Minimal sessionStorage shim for node test env
    const store = new Map<string, string>();
    (globalThis as any).sessionStorage = {
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
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as any);
    expect(readBrandCache('example.com')?.app_display_name).toBe('X');
  });

  it('returns null when the cache is older than TTL', () => {
    vi.useFakeTimers();
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as any);
    vi.advanceTimersByTime(BRAND_CACHE_TTL_MS + 1);
    expect(readBrandCache('example.com')).toBeNull();
    vi.useRealTimers();
  });

  it('returns null when the cached payload is malformed', () => {
    sessionStorage.setItem('brand:example.com', 'not-json');
    expect(readBrandCache('example.com')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/util/brand-bootstrap.spec.ts`
Expected: FAIL with "Cannot find module './brand-bootstrap'".

- [ ] **Step 3: Implement `brand-bootstrap.ts`**

Create `src/client/src/app/core/util/brand-bootstrap.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/util/brand-bootstrap.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire `fetchBrandWithCache` into `main.ts`**

Edit `src/client/src/main.ts`. Replace the `fetchBrand` function body with one that delegates to `fetchBrandWithCache`:

```ts
import { fetchBrandWithCache } from './app/core/util/brand-bootstrap';

async function fetchBrand(): Promise<Brand> {
  if (!environment.production) {
    const params = new URLSearchParams(window.location.search);
    const overrideKind = params.get('wl_kind');
    if (overrideKind === 'agency' || overrideKind === 'super-admin' || overrideKind === 'tenant') {
      const agencyName = params.get('wl_agency_name');
      return {
        ...DEFAULT_BRAND,
        kind: overrideKind,
        id: params.get('wl_id'),
        app_display_name: params.get('wl_name') ?? DEFAULT_BRAND.app_display_name,
        primary_color: params.get('wl_primary') ?? DEFAULT_BRAND.primary_color,
        logo_url: params.get('wl_logo'),
        agency:
          overrideKind === 'tenant' && agencyName
            ? { name: agencyName, logo_url: params.get('wl_agency_logo') }
            : null,
      } as Brand;
    }
  }

  return fetchBrandWithCache(window.location.host, async () => {
    try {
      const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { data, error } = await supabase.rpc('get_brand_by_host', {
        p_host: window.location.host,
      });
      if (error || !data) return null;
      return { ...DEFAULT_BRAND, ...(data as Partial<Brand>) } as Brand;
    } catch {
      return null;
    }
  });
}
```

- [ ] **Step 6: Build and lint**

Run: `cd src/client && ng lint && ng build`
Expected: lint clean, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/core/util/brand-bootstrap.ts src/client/src/app/core/util/brand-bootstrap.spec.ts src/client/src/main.ts
git commit -m "feat(caching): sessionStorage brand cache in main.ts"
```

---

### Task 3: Clear brand cache on branding mutations and broadcast cross-tab

**Files:**
- Modify: `src/client/src/app/core/util/brand-bootstrap.ts`
- Modify: `src/client/src/app/core/util/brand-bootstrap.spec.ts`
- Modify: `src/client/src/app/core/services/tenant.service.ts`
- Modify: `src/client/src/app/core/services/agency.service.ts`

- [ ] **Step 1: Extend the spec with cross-tab clear**

Append to `src/client/src/app/core/util/brand-bootstrap.spec.ts`:

```ts
describe('brand-bootstrap cross-tab clear', () => {
  it('clearBrandCache removes the entry', () => {
    const store = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    };
    writeBrandCache('example.com', { app_display_name: 'X', primary_color: '#000' } as any);
    clearBrandCache('example.com');
    expect(readBrandCache('example.com')).toBeNull();
  });

  it('broadcastBrandInvalidation posts a message when BroadcastChannel is present', () => {
    const posts: unknown[] = [];
    (globalThis as any).BroadcastChannel = class {
      constructor(public name: string) {}
      postMessage(msg: unknown) { posts.push({ name: this.name, msg }); }
      close() {}
    };
    broadcastBrandInvalidation('example.com');
    expect(posts).toEqual([{ name: 'rpc-cache', msg: { type: 'brand-invalidate', host: 'example.com' } }]);
  });
});
```

- [ ] **Step 2: Add `clearBrandCache` (already added in Task 2) and `broadcastBrandInvalidation` to `brand-bootstrap.ts`**

Append to `src/client/src/app/core/util/brand-bootstrap.ts`:

```ts
export function broadcastBrandInvalidation(host: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('rpc-cache');
  try {
    channel.postMessage({ type: 'brand-invalidate', host });
  } finally {
    channel.close();
  }
}

export function installBrandInvalidationListener(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('rpc-cache');
  channel.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'brand-invalidate' && typeof e.data.host === 'string') {
      clearBrandCache(e.data.host);
    }
  });
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/util/brand-bootstrap.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 4: Call `installBrandInvalidationListener` from `main.ts`**

In `src/client/src/main.ts`, after the import for `fetchBrandWithCache`, also import `installBrandInvalidationListener` and call it once at the top of the bootstrap IIFE before `await fetchBrand()`:

```ts
import { fetchBrandWithCache, installBrandInvalidationListener } from './app/core/util/brand-bootstrap';

// ...

(async () => {
  installBrandInvalidationListener();
  const brand = await fetchBrand();
  // ... rest unchanged
})();
```

- [ ] **Step 5: Find the tenant branding mutation method and clear the cache after success**

Run: `grep -n "update_tenant_branding\|updateBranding\|update_agency_branding" src/client/src/app/core/services/*.service.ts`

Open the file that wraps `update_tenant_branding` (likely `tenant.service.ts`). Add to the top of the file:

```ts
import { clearBrandCache, broadcastBrandInvalidation } from '../util/brand-bootstrap';
```

In the method body, after `if (error) throw error;`, add:

```ts
if (typeof window !== 'undefined') {
  clearBrandCache(window.location.host);
  broadcastBrandInvalidation(window.location.host);
}
```

Do the same for `update_agency_branding` in `agency.service.ts`.

- [ ] **Step 6: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: lint clean, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/core/util/brand-bootstrap.ts src/client/src/app/core/util/brand-bootstrap.spec.ts src/client/src/app/core/services/tenant.service.ts src/client/src/app/core/services/agency.service.ts src/client/src/main.ts
git commit -m "feat(caching): clear brand cache on tenant/agency branding update + cross-tab signal"
```

---

## Phase 2: L2 RpcCache core

### Task 4: `stableStringify` key utility

**Files:**
- Create: `src/client/src/app/core/util/stable-stringify.ts`
- Create: `src/client/src/app/core/util/stable-stringify.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/core/util/stable-stringify.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stableStringify } from './stable-stringify';

describe('stableStringify', () => {
  it('serializes primitives', () => {
    expect(stableStringify(1)).toBe('1');
    expect(stableStringify('a')).toBe('"a"');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(true)).toBe('true');
  });

  it('sorts object keys for determinism', () => {
    const a = stableStringify({ b: 2, a: 1 });
    const b = stableStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2}');
  });

  it('recurses into nested objects', () => {
    const a = stableStringify({ x: { b: 2, a: 1 } });
    const b = stableStringify({ x: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(stableStringify([2, 1])).toBe('[2,1]');
    expect(stableStringify([1, 2])).toBe('[1,2]');
  });

  it('handles arrays of objects', () => {
    expect(stableStringify([{ b: 2, a: 1 }])).toBe('[{"a":1,"b":2}]');
  });

  it('serializes undefined as null inside structures', () => {
    expect(stableStringify({ a: undefined })).toBe('{"a":null}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/util/stable-stringify.spec.ts`
Expected: FAIL with "Cannot find module './stable-stringify'".

- [ ] **Step 3: Implement `stable-stringify.ts`**

Create `src/client/src/app/core/util/stable-stringify.ts`:

```ts
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/util/stable-stringify.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/util/stable-stringify.ts src/client/src/app/core/util/stable-stringify.spec.ts
git commit -m "feat(caching): stableStringify key utility"
```

---

### Task 5: RpcCache shell with `get` happy path (miss → fetch → store)

**Files:**
- Create: `src/client/src/app/core/services/rpc-cache.service.ts`
- Create: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RpcCache } from './rpc-cache.service';

function makeCache(): RpcCache {
  return new RpcCache();
}

describe('RpcCache.get happy path', () => {
  it('fetches on miss and stores the result', async () => {
    const cache = makeCache();
    const fetch = vi.fn().mockResolvedValue([{ id: 1 }]);
    const result = await cache.get('list_x', { id: 'a' }, {
      ttl: { fresh: 1000, stale: 5000 },
      tags: ['x:a'],
      fetch,
    });
    expect(result).toEqual([{ id: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the cached entry on hit within the fresh window', async () => {
    const cache = makeCache();
    const fetch = vi.fn().mockResolvedValue([{ id: 1 }]);
    await cache.get('list_x', { id: 'a' }, { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch });
    await cache.get('list_x', { id: 'a' }, { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats different params as separate keys', async () => {
    const cache = makeCache();
    const fetch = vi.fn().mockResolvedValue([]);
    await cache.get('list_x', { id: 'a' }, { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch });
    await cache.get('list_x', { id: 'b' }, { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats object-key reordering as the same key', async () => {
    const cache = makeCache();
    const fetch = vi.fn().mockResolvedValue([]);
    await cache.get('list_x', { a: 1, b: 2 }, { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch });
    await cache.get('list_x', { b: 2, a: 1 }, { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: FAIL with "Cannot find module './rpc-cache.service'".

- [ ] **Step 3: Implement the minimal RpcCache**

Create `src/client/src/app/core/services/rpc-cache.service.ts`:

```ts
import { Injectable } from '@angular/core';
import { stableStringify } from '../util/stable-stringify';

export interface RpcCacheOptions<T> {
  ttl: { fresh: number; stale: number };
  tags: string[];
  fetch: () => Promise<T>;
  swr?: boolean;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
  tags: string[];
  inflight?: Promise<T>;
}

@Injectable({ providedIn: 'root' })
export class RpcCache {
  private entries = new Map<string, CacheEntry<unknown>>();

  async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
    const key = this.makeKey(rpcName, params);
    const now = Date.now();
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;

    if (entry && now < entry.freshUntil) {
      return entry.data;
    }

    return this.fetchAndStore(key, opts);
  }

  private makeKey(rpcName: string, params: object): string {
    return rpcName + ':' + stableStringify(params);
  }

  private async fetchAndStore<T>(key: string, opts: RpcCacheOptions<T>): Promise<T> {
    const now = Date.now();
    const data = await opts.fetch();
    const entry: CacheEntry<T> = {
      data,
      fetchedAt: now,
      freshUntil: now + opts.ttl.fresh,
      staleUntil: opts.ttl.stale === Infinity ? Infinity : now + opts.ttl.stale,
      tags: opts.tags,
    };
    this.entries.set(key, entry as CacheEntry<unknown>);
    return data;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache shell with get happy path"
```

---

### Task 6: Inflight deduplication

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache inflight dedup', () => {
  it('shares a single fetch across concurrent identical calls', async () => {
    const cache = new RpcCache();
    let resolve!: (v: number[]) => void;
    const promise = new Promise<number[]>((r) => { resolve = r; });
    const fetch = vi.fn().mockReturnValue(promise);
    const opts = { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch };

    const a = cache.get('list_x', {}, opts);
    const b = cache.get('list_x', {}, opts);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolve([1, 2, 3]);
    expect(await a).toEqual([1, 2, 3]);
    expect(await b).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "shares a single fetch"`
Expected: FAIL ("expected 2 to equal 1").

- [ ] **Step 3: Add inflight tracking**

Replace the `get` and `fetchAndStore` methods in `rpc-cache.service.ts`:

```ts
async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
  const key = this.makeKey(rpcName, params);
  const now = Date.now();
  const entry = this.entries.get(key) as CacheEntry<T> | undefined;

  if (entry?.inflight) {
    return entry.inflight;
  }

  if (entry && now < entry.freshUntil) {
    return entry.data;
  }

  return this.fetchAndStore(key, opts);
}

private async fetchAndStore<T>(key: string, opts: RpcCacheOptions<T>): Promise<T> {
  const inflight = opts.fetch();
  const placeholder: CacheEntry<T> = {
    data: undefined as unknown as T,
    fetchedAt: 0,
    freshUntil: 0,
    staleUntil: 0,
    tags: opts.tags,
    inflight,
  };
  this.entries.set(key, placeholder as CacheEntry<unknown>);

  try {
    const data = await inflight;
    const now = Date.now();
    this.entries.set(key, {
      data,
      fetchedAt: now,
      freshUntil: now + opts.ttl.fresh,
      staleUntil: opts.ttl.stale === Infinity ? Infinity : now + opts.ttl.stale,
      tags: opts.tags,
    } as CacheEntry<unknown>);
    return data;
  } catch (err) {
    this.entries.delete(key);
    throw err;
  }
}
```

- [ ] **Step 4: Run all RpcCache tests**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache inflight deduplication"
```

---

### Task 7: SWR stale window with background refresh

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache SWR', () => {
  it('returns stale data immediately and refreshes in background', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    let call = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      return [call];
    });
    const opts = { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch };

    const first = await cache.get('list_x', {}, opts);
    expect(first).toEqual([1]);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);  // past freshUntil, within staleUntil

    const second = await cache.get('list_x', {}, opts);
    expect(second).toEqual([1]);  // stale data returned immediately
    expect(fetch).toHaveBeenCalledTimes(2);  // background refresh kicked off

    // Drain background promise
    await vi.advanceTimersByTimeAsync(0);

    const third = await cache.get('list_x', {}, opts);
    expect(third).toEqual([2]);  // new data after refresh
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('past staleUntil, awaits a fresh fetch', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    let call = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      return [call];
    });
    const opts = { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch };

    await cache.get('list_x', {}, opts);
    vi.advanceTimersByTime(10_000);  // past staleUntil
    const result = await cache.get('list_x', {}, opts);
    expect(result).toEqual([2]);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "SWR"`
Expected: FAIL (currently `get` does not implement the stale window).

- [ ] **Step 3: Implement the stale-window branch**

Replace the `get` method in `rpc-cache.service.ts`:

```ts
async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
  const key = this.makeKey(rpcName, params);
  const now = Date.now();
  const entry = this.entries.get(key) as CacheEntry<T> | undefined;

  if (entry?.inflight) {
    return entry.inflight;
  }

  if (entry && now < entry.freshUntil) {
    return entry.data;
  }

  if (entry && now < entry.staleUntil && opts.swr !== false) {
    // Stale-while-revalidate: return cached data immediately, refresh in background.
    void this.fetchAndStore(key, opts).catch(() => {
      // Background refresh failures are silent; entry remains stale until next call.
    });
    return entry.data;
  }

  return this.fetchAndStore(key, opts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache stale-while-revalidate"
```

---

### Task 8: Tag invalidation

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache invalidateTags', () => {
  it('drops entries whose tags intersect the invalidation set', async () => {
    const cache = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1]);

    await cache.get('list_x', { spaceId: 'a' }, {
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: ['space:a:companies'],
      fetch,
    });
    await cache.get('list_y', { spaceId: 'b' }, {
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: ['space:b:companies'],
      fetch,
    });

    cache.invalidateTags(['space:a:companies']);

    // 'a' is dropped; next read refetches. 'b' is preserved.
    await cache.get('list_x', { spaceId: 'a' }, {
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: ['space:a:companies'],
      fetch,
    });
    await cache.get('list_y', { spaceId: 'b' }, {
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: ['space:b:companies'],
      fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(3); // 2 initial + 1 refetch after invalidation
  });

  it('invalidateAll drops every entry', async () => {
    const cache = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1]);
    const opts = { ttl: { fresh: 60_000, stale: 60_000 }, tags: ['x'], fetch };
    await cache.get('a', {}, opts);
    await cache.get('b', {}, opts);
    cache.invalidateAll();
    await cache.get('a', {}, opts);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "invalidateTags"`
Expected: FAIL ("cache.invalidateTags is not a function").

- [ ] **Step 3: Add invalidation methods**

Append to the `RpcCache` class in `rpc-cache.service.ts`:

```ts
invalidateTags(tags: string[]): void {
  if (tags.length === 0) return;
  const tagSet = new Set(tags);
  for (const [key, entry] of this.entries) {
    if (entry.tags.some((t) => tagSet.has(t))) {
      this.entries.delete(key);
    }
  }
}

invalidateAll(): void {
  this.entries.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache tag invalidation"
```

---

### Task 9: BroadcastChannel cross-tab invalidation

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache BroadcastChannel', () => {
  let channels: any[];
  beforeEach(() => {
    channels = [];
    (globalThis as any).BroadcastChannel = class {
      listeners = new Set<(e: { data: unknown }) => void>();
      constructor(public name: string) { channels.push(this); }
      addEventListener(_type: string, fn: (e: { data: unknown }) => void) {
        this.listeners.add(fn);
      }
      postMessage(msg: unknown) {
        for (const other of channels) {
          if (other === this) continue;
          for (const l of other.listeners) l({ data: msg });
        }
      }
      close() {}
    };
  });

  it('posts invalidate messages to other tabs', async () => {
    const cacheA = new RpcCache();
    const cacheB = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1]);
    const opts = { ttl: { fresh: 60_000, stale: 60_000 }, tags: ['space:a:companies'], fetch };

    await cacheA.get('list_x', { id: 'a' }, opts);
    await cacheB.get('list_x', { id: 'a' }, opts);
    expect(fetch).toHaveBeenCalledTimes(2);

    cacheA.invalidateTags(['space:a:companies']);

    // B should have dropped its entry via the broadcast.
    await cacheB.get('list_x', { id: 'a' }, opts);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "BroadcastChannel"`
Expected: FAIL (cacheB does not receive the invalidation).

- [ ] **Step 3: Wire the channel into the constructor and `invalidateTags`**

Update `rpc-cache.service.ts`:

```ts
@Injectable({ providedIn: 'root' })
export class RpcCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('rpc-cache');
      this.channel.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.type === 'invalidate' && Array.isArray(e.data.tags)) {
          this.invalidateTagsLocal(e.data.tags as string[]);
        }
      });
    }
  }

  // ...existing get/fetchAndStore/makeKey unchanged

  invalidateTags(tags: string[]): void {
    if (tags.length === 0) return;
    this.invalidateTagsLocal(tags);
    this.channel?.postMessage({ type: 'invalidate', tags });
  }

  private invalidateTagsLocal(tags: string[]): void {
    const tagSet = new Set(tags);
    for (const [key, entry] of this.entries) {
      if (entry.tags.some((t) => tagSet.has(t))) {
        this.entries.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache BroadcastChannel cross-tab invalidation"
```

---

### Task 10: LRU eviction bound at 200 entries

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache LRU', () => {
  it('evicts least-recently-accessed when size exceeds 200', async () => {
    const cache = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1]);
    const opts = (i: number) => ({
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: [`tag:${i}`],
      fetch,
    });

    // Insert 200 entries
    for (let i = 0; i < 200; i++) {
      await cache.get(`rpc_${i}`, {}, opts(i));
    }
    expect(fetch).toHaveBeenCalledTimes(200);

    // Touch entry 0 so it is NOT the least-recently-accessed
    await cache.get('rpc_0', {}, opts(0));

    // Insert one more (key 200) — should evict the actual LRU (rpc_1)
    await cache.get('rpc_200', {}, opts(200));
    expect(fetch).toHaveBeenCalledTimes(201);

    // rpc_0 should still be cached
    await cache.get('rpc_0', {}, opts(0));
    expect(fetch).toHaveBeenCalledTimes(201);

    // rpc_1 should have been evicted
    await cache.get('rpc_1', {}, opts(1));
    expect(fetch).toHaveBeenCalledTimes(202);
  });

  it('does not evict inflight entries', async () => {
    const cache = new RpcCache();
    const slow = new Promise(() => { /* never resolves */ });
    const slowFetch = vi.fn().mockReturnValue(slow);
    const fastFetch = vi.fn().mockResolvedValue([1]);

    // Start an inflight request that never completes
    void cache.get('slow', {}, { ttl: { fresh: 60_000, stale: 60_000 }, tags: [], fetch: slowFetch });

    // Fill the cache past 200 entries
    for (let i = 0; i < 200; i++) {
      await cache.get(`rpc_${i}`, {}, {
        ttl: { fresh: 60_000, stale: 60_000 },
        tags: [],
        fetch: fastFetch,
      });
    }

    // The inflight entry must still be present.
    // Re-issuing the same call must dedup to the same inflight promise (no new fetch).
    void cache.get('slow', {}, { ttl: { fresh: 60_000, stale: 60_000 }, tags: [], fetch: slowFetch });
    expect(slowFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "LRU"`
Expected: FAIL (LRU not implemented yet; or 200th insert does not evict).

- [ ] **Step 3: Add LRU tracking and eviction**

Update `rpc-cache.service.ts`. Add a field and a touch counter, and call eviction from `fetchAndStore`:

```ts
@Injectable({ providedIn: 'root' })
export class RpcCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private accessOrder = new Map<string, number>();
  private accessCounter = 0;
  private readonly MAX_ENTRIES = 200;
  private channel: BroadcastChannel | null = null;

  // ...constructor unchanged

  async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
    const key = this.makeKey(rpcName, params);
    this.touch(key);
    const now = Date.now();
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;

    if (entry?.inflight) return entry.inflight;
    if (entry && now < entry.freshUntil) return entry.data;
    if (entry && now < entry.staleUntil && opts.swr !== false) {
      void this.fetchAndStore(key, opts).catch(() => undefined);
      return entry.data;
    }
    return this.fetchAndStore(key, opts);
  }

  private touch(key: string): void {
    this.accessCounter += 1;
    this.accessOrder.set(key, this.accessCounter);
  }

  private evictIfOverCapacity(): void {
    if (this.entries.size <= this.MAX_ENTRIES) return;
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.inflight) continue; // never evict inflight
      const access = this.accessOrder.get(key) ?? 0;
      if (access < oldestAccess) {
        oldestAccess = access;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.entries.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
    }
  }

  private async fetchAndStore<T>(key: string, opts: RpcCacheOptions<T>): Promise<T> {
    const inflight = opts.fetch();
    this.entries.set(key, {
      data: undefined as unknown as T,
      fetchedAt: 0, freshUntil: 0, staleUntil: 0,
      tags: opts.tags, inflight,
    } as CacheEntry<unknown>);

    try {
      const data = await inflight;
      const now = Date.now();
      this.entries.set(key, {
        data,
        fetchedAt: now,
        freshUntil: now + opts.ttl.fresh,
        staleUntil: opts.ttl.stale === Infinity ? Infinity : now + opts.ttl.stale,
        tags: opts.tags,
      } as CacheEntry<unknown>);
      this.evictIfOverCapacity();
      return data;
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache LRU eviction at 200 entries"
```

---

### Task 11: Refresh-on-focus via `visibilitychange`

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache refresh-on-focus', () => {
  let visibility: 'visible' | 'hidden' = 'visible';
  let listeners: Array<() => void> = [];

  beforeEach(() => {
    visibility = 'visible';
    listeners = [];
    (globalThis as any).document = {
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') listeners.push(fn);
      },
      removeEventListener: () => undefined,
      get visibilityState() { return visibility; },
    };
  });

  it('triggers background refresh on next access after focus regained past freshUntil', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    let call = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      return [call];
    });
    const opts = { ttl: { fresh: 1000, stale: 60_000 }, tags: [], fetch };

    await cache.get('list_x', {}, opts);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000); // past freshUntil

    visibility = 'hidden';
    listeners.forEach((l) => l());
    visibility = 'visible';
    listeners.forEach((l) => l());

    const second = await cache.get('list_x', {}, opts);
    expect(second).toEqual([1]);                // stale data returned
    expect(fetch).toHaveBeenCalledTimes(2);     // refresh fired
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "refresh-on-focus"`
Expected: FAIL or pass (depending on initial implementation). If the SWR test already implements the stale-window behavior, this test might already pass. Inspect output and confirm the visibility listener is wired before the test setup runs.

- [ ] **Step 3: Wire the listener (no behavior change needed beyond SWR)**

The SWR branch already returns stale-and-refresh when `now > freshUntil`. The visibility listener's role is to mark entries for refresh even when the user has not yet interacted with the cache; but in the current design, the next consumer call triggers the SWR path naturally. Add the listener for symmetry and for the future case where we want to refresh-without-consumer.

Append to the `RpcCache` constructor in `rpc-cache.service.ts`:

```ts
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // No-op for now; the next `get` call hits the SWR path naturally.
      // Hook is in place for a future "refresh in background without consumer" feature.
    }
  });
}
```

- [ ] **Step 4: Run all tests**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache refresh-on-focus listener"
```

---

### Task 12: `swr: false` opt-out

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache swr: false opt-out', () => {
  it('awaits a fresh fetch past freshUntil when swr is false', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    let call = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      return [call];
    });

    await cache.get('list_x', {}, {
      ttl: { fresh: 1000, stale: 60_000 },
      tags: [],
      fetch,
      swr: false,
    });

    vi.advanceTimersByTime(2000); // past freshUntil

    const result = await cache.get('list_x', {}, {
      ttl: { fresh: 1000, stale: 60_000 },
      tags: [],
      fetch,
      swr: false,
    });

    expect(result).toEqual([2]);             // fresh data, not stale
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

The `get` method already checks `opts.swr !== false` in the stale branch. The test should pass on first run after the SWR branch is in place.

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "swr: false"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "test(caching): RpcCache swr:false opt-out coverage"
```

---

### Task 13: Equality-skip emit (deferred to signal accessor)

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache equality-skip emit', () => {
  it('signal does not emit when background refresh returns identical data', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1, 2, 3]);
    const opts = { ttl: { fresh: 1000, stale: 60_000 }, tags: [], fetch };

    await cache.get('list_x', { spaceId: 'a' }, opts);
    const sig = cache.signal<number[]>('list_x', { spaceId: 'a' });
    const emits: Array<number[] | undefined> = [];

    // Subscribe by reading the signal in an effect-like loop.
    // For a node test we just record current value across refreshes.
    emits.push(sig());

    vi.advanceTimersByTime(2000);
    await cache.get('list_x', { spaceId: 'a' }, opts);   // triggers background refresh
    await vi.advanceTimersByTimeAsync(0);

    emits.push(sig());

    // Reference equality: signal value should not change when data is deep-equal.
    expect(emits[0]).toBe(emits[1]);
    vi.useRealTimers();
  });

  it('signal updates when background refresh returns different data', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    let call = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      return [call];
    });
    const opts = { ttl: { fresh: 1000, stale: 60_000 }, tags: [], fetch };

    await cache.get('list_x', {}, opts);
    const sig = cache.signal<number[]>('list_x', {});
    const before = sig();

    vi.advanceTimersByTime(2000);
    await cache.get('list_x', {}, opts);
    await vi.advanceTimersByTimeAsync(0);

    const after = sig();
    expect(after).not.toBe(before);
    expect(after).toEqual([2]);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "equality-skip"`
Expected: FAIL ("cache.signal is not a function").

- [ ] **Step 3: Add signal accessor with equality-skip**

Add to the top of `rpc-cache.service.ts`:

```ts
import { Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { stableStringify } from '../util/stable-stringify';
```

Add to the `CacheEntry` interface:

```ts
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
  tags: string[];
  inflight?: Promise<T>;
  signal: WritableSignal<T | undefined>;
  serializedData: string; // for equality check across refreshes
}
```

Update `fetchAndStore` to populate the signal and skip emits when data is equal:

```ts
private async fetchAndStore<T>(key: string, opts: RpcCacheOptions<T>): Promise<T> {
  const inflight = opts.fetch();
  const existing = this.entries.get(key) as CacheEntry<T> | undefined;
  const sig = existing?.signal ?? (signal<T | undefined>(undefined) as WritableSignal<T | undefined>);
  this.entries.set(key, {
    data: existing?.data as T,
    fetchedAt: 0, freshUntil: 0, staleUntil: 0,
    tags: opts.tags,
    inflight,
    signal: sig as WritableSignal<unknown>,
    serializedData: existing?.serializedData ?? '',
  } as CacheEntry<unknown>);

  try {
    const data = await inflight;
    const now = Date.now();
    const serialized = stableStringify(data as unknown);
    const prev = this.entries.get(key) as CacheEntry<T> | undefined;
    this.entries.set(key, {
      data,
      fetchedAt: now,
      freshUntil: now + opts.ttl.fresh,
      staleUntil: opts.ttl.stale === Infinity ? Infinity : now + opts.ttl.stale,
      tags: opts.tags,
      signal: sig as WritableSignal<unknown>,
      serializedData: serialized,
    } as CacheEntry<unknown>);

    if (serialized !== prev?.serializedData) {
      sig.set(data);
    }
    this.evictIfOverCapacity();
    return data;
  } catch (err) {
    this.entries.delete(key);
    throw err;
  }
}
```

Add the `signal` public method:

```ts
signal<T>(rpcName: string, params: object): Signal<T | undefined> {
  const key = this.makeKey(rpcName, params);
  let entry = this.entries.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    const sig = signal<T | undefined>(undefined) as WritableSignal<T | undefined>;
    entry = {
      data: undefined as unknown as T,
      fetchedAt: 0, freshUntil: 0, staleUntil: 0,
      tags: [],
      signal: sig as WritableSignal<unknown>,
      serializedData: '',
    };
    this.entries.set(key, entry as CacheEntry<unknown>);
  }
  return entry.signal as Signal<T | undefined>;
}
```

- [ ] **Step 4: Run all tests**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts
git commit -m "feat(caching): RpcCache signal accessor with equality-skip emit"
```

---

### Task 14: Dev-only telemetry counters

**Files:**
- Modify: `src/client/src/app/core/services/rpc-cache.service.ts`
- Modify: `src/client/src/app/core/services/rpc-cache.spec.ts`

- [ ] **Step 1: Append the failing test**

Append to `src/client/src/app/core/services/rpc-cache.spec.ts`:

```ts
describe('RpcCache dev telemetry', () => {
  it('increments hit / miss / backgroundRefresh / invalidation counters', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    cache.enableDevStats();
    const fetch = vi.fn().mockResolvedValue([1]);
    const opts = { ttl: { fresh: 1000, stale: 60_000 }, tags: ['t'], fetch };

    await cache.get('list_x', {}, opts);     // miss
    await cache.get('list_x', {}, opts);     // hit (fresh)
    vi.advanceTimersByTime(2000);
    await cache.get('list_x', {}, opts);     // hit (stale) + bg refresh
    await vi.advanceTimersByTimeAsync(0);
    cache.invalidateTags(['t']);             // invalidation

    const stats = cache.getDevStats();
    expect(stats.byRpc['list_x']).toEqual({
      hits: 2,
      misses: 1,
      backgroundRefreshes: 1,
      invalidations: 1,
    });
    vi.useRealTimers();
  });

  it('does nothing when devStats is not enabled', async () => {
    const cache = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1]);
    await cache.get('list_x', {}, { ttl: { fresh: 1000, stale: 5000 }, tags: [], fetch });
    expect(cache.getDevStats()).toEqual({ byRpc: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts -t "dev telemetry"`
Expected: FAIL ("cache.enableDevStats is not a function").

- [ ] **Step 3: Add telemetry to `rpc-cache.service.ts`**

Add the interface and the methods. Add to the top of the class:

```ts
interface RpcCacheStats {
  byRpc: Record<string, {
    hits: number;
    misses: number;
    backgroundRefreshes: number;
    invalidations: number;
  }>;
}

// inside class:
private stats: RpcCacheStats | null = null;

enableDevStats(): void {
  this.stats = { byRpc: {} };
}

getDevStats(): RpcCacheStats {
  return this.stats ?? { byRpc: {} };
}

private recordStat(rpcName: string, kind: 'hits' | 'misses' | 'backgroundRefreshes' | 'invalidations'): void {
  if (!this.stats) return;
  const row = this.stats.byRpc[rpcName] ?? { hits: 0, misses: 0, backgroundRefreshes: 0, invalidations: 0 };
  row[kind] += 1;
  this.stats.byRpc[rpcName] = row;
}
```

Thread the calls through `get` and `invalidateTags`:

```ts
async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
  const key = this.makeKey(rpcName, params);
  this.touch(key);
  const now = Date.now();
  const entry = this.entries.get(key) as CacheEntry<T> | undefined;

  if (entry?.inflight) {
    this.recordStat(rpcName, 'hits');
    return entry.inflight;
  }

  if (entry && now < entry.freshUntil) {
    this.recordStat(rpcName, 'hits');
    return entry.data;
  }

  if (entry && now < entry.staleUntil && opts.swr !== false) {
    this.recordStat(rpcName, 'hits');
    this.recordStat(rpcName, 'backgroundRefreshes');
    void this.fetchAndStore(key, opts).catch(() => undefined);
    return entry.data;
  }

  this.recordStat(rpcName, 'misses');
  return this.fetchAndStore(key, opts);
}

invalidateTags(tags: string[]): void {
  if (tags.length === 0) return;
  this.invalidateTagsLocal(tags);
  this.channel?.postMessage({ type: 'invalidate', tags });
  if (this.stats) {
    // Attribute the invalidation to every RPC whose cached entry had any of these tags.
    const tagSet = new Set(tags);
    for (const [, entry] of this.entries) {
      // Walk all entries to find rpc names; key is "rpc:params".
    }
    // Simpler: record one bucket per provided tag-rpc match. Since the entries are gone,
    // we attribute to the rpcName parsed from each evicted key.
  }
}
```

The simplest accurate attribution: change `invalidateTagsLocal` to return the list of evicted RPC names, then bump stats:

```ts
invalidateTags(tags: string[]): void {
  if (tags.length === 0) return;
  const evictedRpcs = this.invalidateTagsLocal(tags);
  this.channel?.postMessage({ type: 'invalidate', tags });
  if (this.stats) {
    for (const rpc of evictedRpcs) this.recordStat(rpc, 'invalidations');
  }
}

private invalidateTagsLocal(tags: string[]): string[] {
  const tagSet = new Set(tags);
  const evictedRpcs: string[] = [];
  for (const [key, entry] of this.entries) {
    if (entry.tags.some((t) => tagSet.has(t))) {
      const rpcName = key.split(':')[0];
      evictedRpcs.push(rpcName);
      this.entries.delete(key);
    }
  }
  return evictedRpcs;
}
```

- [ ] **Step 4: Run all tests**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/rpc-cache.spec.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Wire `enableDevStats` and `window.__rpcCacheStats` in `app.config.ts` for dev builds**

Open `src/client/src/app/app.config.ts` and add an APP_INITIALIZER (or environment-gated provider). Append the following provider section to the `appConfig.providers` array:

```ts
import { APP_INITIALIZER, inject } from '@angular/core';
import { RpcCache } from './core/services/rpc-cache.service';
import { environment } from '../environments/environment';

// inside providers:
{
  provide: APP_INITIALIZER,
  multi: true,
  useFactory: () => {
    const cache = inject(RpcCache);
    return () => {
      if (!environment.production) {
        cache.enableDevStats();
        (window as Window & { __rpcCacheStats?: () => unknown }).__rpcCacheStats =
          () => cache.getDevStats();
      }
    };
  },
},
```

- [ ] **Step 6: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: lint clean, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/core/services/rpc-cache.service.ts src/client/src/app/core/services/rpc-cache.spec.ts src/client/src/app/app.config.ts
git commit -m "feat(caching): RpcCache dev-only telemetry on window.__rpcCacheStats"
```

---

## Phase 3: Reference-tier service migrations

### Task 15: Migrate `CompanyService` and its product cross-invalidation

**Files:**
- Modify: `src/client/src/app/core/services/company.service.ts`

- [ ] **Step 1: Add cache routing to reads and tag invalidation to writes**

Replace `src/client/src/app/core/services/company.service.ts`:

```ts
import { inject, Injectable } from '@angular/core';

import { Company } from '../models/company.model';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<Company[]> {
    return this.cache.get('list_companies', { spaceId }, {
      ttl: REFERENCE_TTL,
      tags: [`space:${spaceId}:companies`],
      fetch: async () => {
        const { data, error } = await this.supabase.client
          .from('companies')
          .select('*, products(*)')
          .eq('space_id', spaceId)
          .order('display_order');
        if (error) throw error;
        return (data ?? []) as Company[];
      },
    });
  }

  async getById(id: string): Promise<Company> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .select('*, products(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as Company;
  }

  async create(spaceId: string, company: Partial<Company>): Promise<Company> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('companies')
      .insert({ ...company, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:companies`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as Company;
  }

  async update(id: string, changes: Partial<Company>): Promise<Company> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const spaceId = (data as Company).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:companies`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as Company;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('companies')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client.from('companies').delete().eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:companies`,
        `space:${existing.space_id}:dashboard`,
        `space:${existing.space_id}:landing-stats`,
      ]);
    }
  }
}
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: lint clean, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/company.service.ts
git commit -m "feat(caching): route CompanyService through RpcCache with tag invalidation"
```

---

### Task 16: Migrate product writes (cross-invalidate `companies` because of LATERAL embed)

**Files:**
- Modify: the service file that owns product create/update/delete

- [ ] **Step 1: Locate the product service**

Run: `grep -ln "from('products')\|'create_product'\|'update_product'\|'delete_product'" src/client/src/app/core/services/*.service.ts`

Expected output: a file path (e.g., `product.service.ts` or `asset.service.ts`).

- [ ] **Step 2: Wrap reads in `RpcCache.get` and add tag invalidation to writes**

In the located file, at the top:

```ts
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };
```

In the class:

```ts
private cache = inject(RpcCache);
```

For each list/read method, wrap the existing Supabase call in:

```ts
return this.cache.get('list_products', { spaceId }, {
  ttl: REFERENCE_TTL,
  tags: [`space:${spaceId}:products`],
  fetch: async () => {
    // existing body returning data
  },
});
```

For each create/update/delete, after the `if (error) throw error;` line, append:

```ts
this.cache.invalidateTags([
  `space:${spaceId}:products`,
  `space:${spaceId}:companies`,        // LATERAL embed in list_companies
  `space:${spaceId}:dashboard`,
  `space:${spaceId}:landing-stats`,
]);
```

If the write method does not receive `spaceId` directly, fetch the parent product's `space_id` (`select space_id ... where id = $1`) before the mutation so it is available for invalidation.

- [ ] **Step 3: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: lint clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/services/<product-service-file>.ts
git commit -m "feat(caching): route product service through RpcCache with cross-invalidation"
```

---

### Task 17: Migrate `TherapeuticAreaService`

**Files:**
- Modify: `src/client/src/app/core/services/therapeutic-area.service.ts`

- [ ] **Step 1: Replace the file**

```ts
import { inject, Injectable } from '@angular/core';

import { TherapeuticArea } from '../models/trial.model';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class TherapeuticAreaService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<TherapeuticArea[]> {
    return this.cache.get('list_therapeutic_areas', { spaceId }, {
      ttl: REFERENCE_TTL,
      tags: [`space:${spaceId}:therapeutic-areas`],
      fetch: async () => {
        const { data, error } = await this.supabase.client
          .from('therapeutic_areas')
          .select('*')
          .eq('space_id', spaceId)
          .order('name');
        if (error) throw error;
        return (data ?? []) as TherapeuticArea[];
      },
    });
  }

  async create(spaceId: string, area: Partial<TherapeuticArea>): Promise<TherapeuticArea> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .insert({ ...area, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:therapeutic-areas`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as TherapeuticArea;
  }

  async update(id: string, changes: Partial<TherapeuticArea>): Promise<TherapeuticArea> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const spaceId = (data as TherapeuticArea).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:therapeutic-areas`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as TherapeuticArea;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('therapeutic_areas')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client.from('therapeutic_areas').delete().eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:therapeutic-areas`,
        `space:${existing.space_id}:dashboard`,
        `space:${existing.space_id}:landing-stats`,
      ]);
    }
  }
}
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/therapeutic-area.service.ts
git commit -m "feat(caching): route TherapeuticAreaService through RpcCache"
```

---

### Task 18: Migrate `MechanismOfActionService` and `RouteOfAdministrationService`

**Files:**
- Modify: `src/client/src/app/core/services/mechanism-of-action.service.ts`
- Modify: `src/client/src/app/core/services/route-of-administration.service.ts`

- [ ] **Step 1: Apply the same shape as `TherapeuticAreaService` for both files**

For `mechanism-of-action.service.ts`, replace the read method body with:

```ts
async list(spaceId: string): Promise<MechanismOfAction[]> {
  return this.cache.get('list_mechanisms_of_action', { spaceId }, {
    ttl: REFERENCE_TTL,
    tags: [`space:${spaceId}:moa`],
    fetch: async () => {
      const { data, error } = await this.supabase.client
        .from('mechanisms_of_action')
        .select('*')
        .eq('space_id', spaceId)
        .order('display_order')
        .order('name');
      if (error) throw error;
      return (data ?? []) as MechanismOfAction[];
    },
  });
}
```

For each write (create / update / delete), invalidate:

```ts
this.cache.invalidateTags([
  `space:${spaceId}:moa`,
  `space:${spaceId}:products`,        // products embed MoA via LATERAL
  `space:${spaceId}:dashboard`,
]);
```

For `route-of-administration.service.ts`, the same shape with `roa` instead of `moa`:

```ts
async list(spaceId: string): Promise<RouteOfAdministration[]> {
  return this.cache.get('list_routes_of_administration', { spaceId }, {
    ttl: REFERENCE_TTL,
    tags: [`space:${spaceId}:roa`],
    fetch: async () => {
      const { data, error } = await this.supabase.client
        .from('routes_of_administration')
        .select('*')
        .eq('space_id', spaceId)
        .order('display_order')
        .order('name');
      if (error) throw error;
      return (data ?? []) as RouteOfAdministration[];
    },
  });
}
```

Writes invalidate `[`space:${spaceId}:roa`, `space:${spaceId}:products`, `space:${spaceId}:dashboard`]`.

Each file needs `private cache = inject(RpcCache);` and the same `const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };` constant at the top.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/mechanism-of-action.service.ts src/client/src/app/core/services/route-of-administration.service.ts
git commit -m "feat(caching): route MoA and RoA services through RpcCache"
```

---

### Task 19: Migrate marker / event lookup services

**Files:**
- Modify: `src/client/src/app/core/services/marker-type.service.ts`
- Modify: `src/client/src/app/core/services/marker-category.service.ts`
- Modify: `src/client/src/app/core/services/event-category.service.ts`

- [ ] **Step 1: Wrap each `list` method in `RpcCache.get` with the shared global tag**

For each file:

```ts
import { RpcCache } from './rpc-cache.service';

private cache = inject(RpcCache);

async list(): Promise<MarkerType[]> {   // adjust type per file
  return this.cache.get('marker_types', {}, {                // adjust name per file: marker_types, marker_categories, event_categories
    ttl: { fresh: 30 * 60 * 1000, stale: Infinity },
    tags: ['markers:types'],
    fetch: async () => {
      const { data, error } = await this.supabase.client
        .from('marker_types')                                  // adjust table per file
        .select('*');
      if (error) throw error;
      return (data ?? []) as MarkerType[];                     // adjust type
    },
  });
}
```

For any super-admin write paths (`upsert_marker_type` etc., if present in the service), after success:

```ts
this.cache.invalidateTags(['markers:types']);
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/marker-type.service.ts src/client/src/app/core/services/marker-category.service.ts src/client/src/app/core/services/event-category.service.ts
git commit -m "feat(caching): route marker/event lookup services through RpcCache"
```

---

## Phase 4: Heavy-aggregation tier migrations

### Task 20: Migrate `DashboardService.getDashboardData`

**Files:**
- Modify: `src/client/src/app/core/services/dashboard.service.ts`

- [ ] **Step 1: Wrap the read in `RpcCache.get`**

At the top of `dashboard.service.ts`:

```ts
import { RpcCache } from './rpc-cache.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };
```

In the class:

```ts
private cache = inject(RpcCache);

async getDashboardData(spaceId: string, filters: DashboardFilters): Promise<DashboardData> {
  return this.cache.get('get_dashboard_data', { spaceId, filters }, {
    ttl: HEAVY_TTL,
    tags: [`space:${spaceId}:dashboard`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('get_dashboard_data', {
        p_space_id: spaceId,
        // ...the full filter set the existing method already passes through
      });
      if (error) throw error;
      return data as DashboardData;
    },
  });
}
```

Preserve the exact parameter list the existing method passes. The cache key includes the full filter object, so different filter combinations cache independently.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/dashboard.service.ts
git commit -m "feat(caching): route DashboardService through RpcCache (heavy tier)"
```

---

### Task 21: Migrate `ChangeEventService.getActivityFeed`

**Files:**
- Modify: `src/client/src/app/core/services/change-event.service.ts`

- [ ] **Step 1: Wrap the activity-feed call in `RpcCache.get`**

```ts
import { RpcCache } from './rpc-cache.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

// inside the class:
private cache = inject(RpcCache);

async getActivityFeed(spaceId: string, filters: ActivityFeedFilters, cursor?: ActivityFeedCursor, limit?: number) {
  return this.cache.get('get_activity_feed', { spaceId, filters, cursor, limit }, {
    ttl: HEAVY_TTL,
    tags: [`space:${spaceId}:activity`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('get_activity_feed', {
        p_space_id: spaceId,
        p_filters: filters,
        p_cursor_observed_at: cursor?.observedAt ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_limit: limit ?? null,
      });
      if (error) throw error;
      return data;
    },
  });
}
```

Adapt the parameter names to match the existing method signature.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/change-event.service.ts
git commit -m "feat(caching): route ChangeEventService activity feed through RpcCache"
```

---

### Task 22: Migrate `PrimaryIntelligenceService.list`

**Files:**
- Modify: `src/client/src/app/core/services/primary-intelligence.service.ts`

- [ ] **Step 1: Wrap the list read and invalidate on writes**

```ts
import { RpcCache } from './rpc-cache.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

// inside the class:
private cache = inject(RpcCache);

async list(spaceId: string, filters: PrimaryIntelligenceFilters): Promise<PrimaryIntelligenceRow[]> {
  return this.cache.get('list_primary_intelligence', { spaceId, filters }, {
    ttl: HEAVY_TTL,
    tags: [`space:${spaceId}:primary-intelligence`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('list_primary_intelligence', {
        p_space_id: spaceId,
        // ...existing parameters
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

For each mutation method (`create`, `update`, `publish`, state transitions, `delete`), after `if (error) throw error;`, append:

```ts
this.cache.invalidateTags([
  `space:${spaceId}:primary-intelligence`,
  `space:${spaceId}:drafts`,
  `space:${spaceId}:activity`,
  `space:${spaceId}:landing-stats`,
  ...(linkedTrialId ? [`trial:${linkedTrialId}:detail`] : []),
]);
```

If the mutation does not have `spaceId` in scope, read it from the existing record (`select space_id, ... where id = $1`) before the mutation.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/primary-intelligence.service.ts
git commit -m "feat(caching): route PrimaryIntelligenceService through RpcCache"
```

---

### Task 23: Migrate `SpaceService.getLandingStats`

**Files:**
- Modify: `src/client/src/app/core/services/space.service.ts`

- [ ] **Step 1: Wrap the call**

Add at top:

```ts
import { RpcCache } from './rpc-cache.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };
```

In the class:

```ts
private cache = inject(RpcCache);

async getLandingStats(spaceId: string) {
  return this.cache.get('get_space_landing_stats', { spaceId }, {
    ttl: HEAVY_TTL,
    tags: [`space:${spaceId}:landing-stats`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('get_space_landing_stats', { p_space_id: spaceId });
      if (error) throw error;
      return data;
    },
  });
}
```

(If the existing method already exists, replace its body; if not, add it. Match the existing method signature if it exists.)

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/space.service.ts
git commit -m "feat(caching): route SpaceService landing stats through RpcCache"
```

---

### Task 24: Migrate `TrialService.getDetailWithIntelligence`

**Files:**
- Modify: `src/client/src/app/core/services/trial.service.ts`

- [ ] **Step 1: Wrap the detail call**

```ts
import { RpcCache } from './rpc-cache.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

// in the class:
private cache = inject(RpcCache);

async getDetailWithIntelligence(trialId: string) {
  return this.cache.get('get_trial_detail_with_intelligence', { trialId }, {
    ttl: HEAVY_TTL,
    tags: [`trial:${trialId}:detail`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('get_trial_detail_with_intelligence', {
        p_trial_id: trialId,
      });
      if (error) throw error;
      return data;
    },
  });
}
```

For trial mutations (`updateTrial`, `placeMarker`, `deleteMarker`, etc.) in this file or wherever they live, append after the success path:

```ts
this.cache.invalidateTags([
  `trial:${trialId}:detail`,
  `space:${spaceId}:dashboard`,
  `space:${spaceId}:activity`,
  `space:${spaceId}:landing-stats`,
]);
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/trial.service.ts
git commit -m "feat(caching): route TrialService detail through RpcCache"
```

---

### Task 25: Migrate `MaterialService` (3 list methods + write invalidation)

**Files:**
- Modify: `src/client/src/app/core/services/material.service.ts`

- [ ] **Step 1: Wrap all three list methods and invalidate on writes**

```ts
import { RpcCache } from './rpc-cache.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

// in the class:
private cache = inject(RpcCache);

async listRecentForSpace(spaceId: string, limit?: number) {
  return this.cache.get('list_recent_materials_for_space', { spaceId, limit }, {
    ttl: HEAVY_TTL,
    tags: [`space:${spaceId}:materials`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('list_recent_materials_for_space', {
        p_space_id: spaceId,
        p_limit: limit ?? null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

async listDraftsForSpace(spaceId: string, limit?: number) {
  return this.cache.get('list_draft_intelligence_for_space', { spaceId, limit }, {
    ttl: HEAVY_TTL,
    tags: [`space:${spaceId}:drafts`, `space:${spaceId}:primary-intelligence`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('list_draft_intelligence_for_space', {
        p_space_id: spaceId,
        p_limit: limit ?? null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

async listForEntity(entityType: string, entityId: string, materialTypes?: string[], limit?: number, offset?: number) {
  return this.cache.get('list_materials_for_entity', { entityType, entityId, materialTypes, limit, offset }, {
    ttl: HEAVY_TTL,
    tags: [`entity:${entityType}:${entityId}:materials`, `space:${this.spaceContext()}:materials`],
    fetch: async () => {
      const { data, error } = await this.supabase.client.rpc('list_materials_for_entity', {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_material_types: materialTypes ?? null,
        p_limit: limit ?? null,
        p_offset: offset ?? null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

`spaceContext()` should be an existing helper that returns the active space id. If it does not exist, accept `spaceId` as an additional parameter to `listForEntity` (preferred over wiring a new context coupling).

For uploads / deletes:

```ts
this.cache.invalidateTags([
  `entity:${entityType}:${entityId}:materials`,
  `space:${spaceId}:materials`,
  `space:${spaceId}:activity`,
]);
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/material.service.ts
git commit -m "feat(caching): route MaterialService through RpcCache (3 list methods + invalidation)"
```

---

## Phase 5: Verification and tuning

### Task 26: Manual verification + telemetry snapshot

**Files:**
- No files modified.

- [ ] **Step 1: Run the full local stack**

```bash
supabase start
cd src/client && npm start
```

- [ ] **Step 2: Verify dedup in DevTools**

Open the app on a page that loads several reference lookups on first paint (e.g., a space dashboard). In the Network tab, filter to `/rest/v1/`. Confirm:

- `companies?...` appears once, not multiple times.
- `therapeutic_areas?...`, `mechanisms_of_action?...`, `routes_of_administration?...` each appear once.

- [ ] **Step 3: Verify SWR**

Navigate away from the dashboard and back within 30 seconds. Confirm: no spinner, content shows instantly. Wait 90 seconds, click anything that triggers `get_dashboard_data`. Confirm: content shows instantly (stale-served), then a network request fires in the background.

- [ ] **Step 4: Verify cross-tab invalidation**

Open two browser tabs on the same space. In tab A, edit a company name and save. In tab B, navigate to the companies list. Confirm the new name appears (within a refresh of the page; the BroadcastChannel drop has happened so the next read fetches fresh).

- [ ] **Step 5: Verify brand cache**

Reload the app. In the Network tab, confirm `get_brand_by_host` is called once on the first load. Reload again. Confirm `get_brand_by_host` is NOT called on the second reload (served from `sessionStorage`). Open DevTools Application -> Session Storage -> the active host. Confirm a `brand:<host>` key exists.

- [ ] **Step 6: Read telemetry**

In the browser console:

```js
__rpcCacheStats()
```

Expect an object with `byRpc` rows for the RPCs you exercised. Sanity check: `hits` plus `misses` per RPC roughly equals the number of times that view was accessed.

- [ ] **Step 7: Spot-check `pg_stat_statements` if local Postgres records it**

Connect to the local Supabase Postgres and run:

```sql
select query, calls
from pg_stat_statements
where query ilike '%list_companies%'
   or query ilike '%get_dashboard_data%'
order by calls desc;
```

(Optional. The real verification is the production-side delta after one week of usage.)

- [ ] **Step 8: Document the snapshot**

Append a short verification note to the spec at `docs/superpowers/specs/2026-05-14-caching-strategy-design.md` under a new heading "## Phase 5 verification (2026-05-XX)":

```
- Network tab: companies + reference lookups deduplicated to 1 request each on a dashboard load.
- SWR: no spinner on navigation back to dashboards within 90s; background refresh observed in network tab.
- Brand cache: 1 call on first load, 0 calls on subsequent reloads within 5 min.
- __rpcCacheStats: hit ratio over 70% on reference RPCs, 40-60% on heavy aggregations.
- Cross-tab invalidation: edit in tab A reflected in tab B on next access.
```

Commit:

```bash
git add docs/superpowers/specs/2026-05-14-caching-strategy-design.md
git commit -m "docs(caching): phase 5 verification snapshot"
```

---

## Final lint and full-test pass

After all tasks are complete:

```bash
cd src/client && ng lint && ng build && npm run test:units
```

Expected: lint clean, build succeeds, all units pass (including the new `rpc-cache.spec.ts`, `stable-stringify.spec.ts`, `brand-bootstrap.spec.ts`).

```bash
git status
```

Expected: clean working tree.
