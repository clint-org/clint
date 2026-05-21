import { describe, it, expect, vi, beforeEach } from 'vitest';
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

    await vi.advanceTimersByTimeAsync(0);

    const third = await cache.get('list_x', {}, opts);
    expect(third).toEqual([2]);
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
    vi.advanceTimersByTime(10_000);
    const result = await cache.get('list_x', {}, opts);
    expect(result).toEqual([2]);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

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

    expect(fetch).toHaveBeenCalledTimes(3);
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

describe('RpcCache LRU', () => {
  it('evicts least-recently-accessed when size exceeds 200', async () => {
    const cache = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1]);
    const opts = (i: number) => ({
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: [`tag:${i}`],
      fetch,
    });

    for (let i = 0; i < 200; i++) {
      await cache.get(`rpc_${i}`, {}, opts(i));
    }
    expect(fetch).toHaveBeenCalledTimes(200);

    await cache.get('rpc_0', {}, opts(0));

    await cache.get('rpc_200', {}, opts(200));
    expect(fetch).toHaveBeenCalledTimes(201);

    await cache.get('rpc_0', {}, opts(0));
    expect(fetch).toHaveBeenCalledTimes(201);

    await cache.get('rpc_1', {}, opts(1));
    expect(fetch).toHaveBeenCalledTimes(202);
  });

  it('does not evict inflight entries', async () => {
    const cache = new RpcCache();
    const slow = new Promise(() => { /* never resolves */ });
    const slowFetch = vi.fn().mockReturnValue(slow);
    const fastFetch = vi.fn().mockResolvedValue([1]);

    void cache.get('slow', {}, { ttl: { fresh: 60_000, stale: 60_000 }, tags: [], fetch: slowFetch });

    for (let i = 0; i < 200; i++) {
      await cache.get(`rpc_${i}`, {}, {
        ttl: { fresh: 60_000, stale: 60_000 },
        tags: [],
        fetch: fastFetch,
      });
    }

    void cache.get('slow', {}, { ttl: { fresh: 60_000, stale: 60_000 }, tags: [], fetch: slowFetch });
    expect(slowFetch).toHaveBeenCalledTimes(1);
  });
});

describe('RpcCache refresh-on-focus', () => {
  let visibility: 'visible' | 'hidden' = 'visible';
  let listeners: (() => void)[] = [];

  beforeEach(() => {
    visibility = 'visible';
    listeners = [];
    (globalThis as { document: Document }).document = {
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') listeners.push(fn);
      },
      removeEventListener: () => undefined,
      get visibilityState() { return visibility; },
    } as unknown as Document;
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
    expect(second).toEqual([1]);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('RpcCache BroadcastChannel', () => {
  interface FakeChannel {
    name: string;
    listeners: Set<(e: { data: unknown }) => void>;
    postMessage(msg: unknown): void;
    close(): void;
  }
  let channels: FakeChannel[];
  beforeEach(() => {
    channels = [];
    (globalThis as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel = class {
      listeners = new Set<(e: { data: unknown }) => void>();
      constructor(public name: string) { channels.push(this as FakeChannel); }
      addEventListener(_type: string, fn: (e: { data: unknown }) => void) {
        this.listeners.add(fn);
      }
      postMessage(msg: unknown) {
        for (const other of channels) {
          if (other === (this as unknown as FakeChannel)) continue;
          for (const l of other.listeners) l({ data: msg });
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      close() {}
    } as unknown as typeof BroadcastChannel;
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

    await cacheB.get('list_x', { id: 'a' }, opts);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

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
    cache.invalidateTags(['t']);

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

describe('RpcCache invalidation during inflight', () => {
  it('does not repopulate the cache when invalidation fires before the inflight fetch resolves', async () => {
    const cache = new RpcCache();
    let resolve!: (v: number[]) => void;
    const promise = new Promise<number[]>((r) => { resolve = r; });
    const fetch = vi.fn().mockReturnValueOnce(promise).mockResolvedValueOnce([2]);

    const firstCall = cache.get('list_x', {}, {
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: ['t'],
      fetch,
    });

    // Invalidate while the first fetch is still inflight.
    cache.invalidateTags(['t']);

    resolve([1]);
    await firstCall;

    // The next get must NOT see the stale result; it must trigger a fresh fetch.
    const second = await cache.get('list_x', {}, {
      ttl: { fresh: 60_000, stale: 60_000 },
      tags: ['t'],
      fetch,
    });

    expect(second).toEqual([2]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

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

    vi.advanceTimersByTime(2000);

    const result = await cache.get('list_x', {}, {
      ttl: { fresh: 1000, stale: 60_000 },
      tags: [],
      fetch,
      swr: false,
    });

    expect(result).toEqual([2]);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('RpcCache equality-skip emit', () => {
  it('signal does not emit when background refresh returns identical data', async () => {
    vi.useFakeTimers();
    const cache = new RpcCache();
    const fetch = vi.fn().mockResolvedValue([1, 2, 3]);
    const opts = { ttl: { fresh: 1000, stale: 60_000 }, tags: [], fetch };

    await cache.get('list_x', { spaceId: 'a' }, opts);
    const sig = cache.signal<number[]>('list_x', { spaceId: 'a' });
    const emits: (number[] | undefined)[] = [];

    emits.push(sig());

    vi.advanceTimersByTime(2000);
    await cache.get('list_x', { spaceId: 'a' }, opts);
    await vi.advanceTimersByTimeAsync(0);

    emits.push(sig());

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
