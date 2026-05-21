import { describe, it, expect, vi } from 'vitest';
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
