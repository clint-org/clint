import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalystService } from './catalyst.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface ClientStub {
  rpc: ReturnType<typeof vi.fn>;
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeRpcResult(data: unknown, error: unknown = null) {
  const obj = { throwOnError: vi.fn() };
  obj.throwOnError.mockReturnValue(obj);
  const t = obj as unknown as PromiseLike<{ data: unknown; error: unknown }>;
  (t as { then: PromiseLike<unknown>['then'] }).then = (
    onFulfilled?: ((v: { data: unknown; error: unknown }) => unknown) | null,
    onRejected?: ((r: unknown) => unknown) | null,
  ) => {
    if (error) return Promise.reject(error).then(null, onRejected);
    return Promise.resolve({ data, error: null }).then(onFulfilled ?? undefined);
  };
  return obj;
}

function makeService(client: ClientStub, cache: CacheStub): CatalystService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new CatalystService());
}

describe('CatalystService.getCatalystDetail', () => {
  it('routes through cache.get with rpcName, key, tag, and HEAVY_TTL', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'marker-1' });
    const service = makeService(
      { rpc: vi.fn() },
      { get, invalidateTags: vi.fn() }
    );

    await service.getCatalystDetail('marker-1');

    expect(get).toHaveBeenCalledTimes(1);
    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_catalyst_detail');
    expect(params).toEqual({ markerId: 'marker-1' });
    expect(opts.tags).toEqual(['catalyst:marker-1:detail']);
    expect(opts.ttl).toEqual({ fresh: 30 * 1000, stale: 5 * 60 * 1000 });
  });

  it('invokes the supabase rpc via the fetch callback', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult({ id: 'marker-2' }));
    const get = vi.fn().mockImplementation((_rpc, _params, opts: { fetch: () => Promise<unknown> }) =>
      opts.fetch()
    );
    const service = makeService(
      { rpc },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.getCatalystDetail('marker-2');

    expect(rpc).toHaveBeenCalledWith('get_catalyst_detail', { p_marker_id: 'marker-2' });
    expect(result).toEqual({ id: 'marker-2' });
  });

  it('re-throws when supabase rpc returns an error', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null, new Error('rpc failed')));
    const get = vi.fn().mockImplementation((_rpc, _params, opts: { fetch: () => Promise<unknown> }) =>
      opts.fetch()
    );
    const service = makeService(
      { rpc },
      { get, invalidateTags: vi.fn() }
    );

    await expect(service.getCatalystDetail('marker-1')).rejects.toThrow('rpc failed');
  });
});
