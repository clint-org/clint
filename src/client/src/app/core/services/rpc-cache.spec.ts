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
