import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { IntelligenceFeedService } from './intelligence-feed.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

function makeRpcResult(data: unknown) {
  const obj = { throwOnError: vi.fn() };
  obj.throwOnError.mockReturnValue(obj);
  const t = obj as unknown as PromiseLike<{ data: unknown; error: unknown }>;
  (t as { then: PromiseLike<unknown>['then'] }).then = (
    onFulfilled?: ((v: { data: unknown; error: unknown }) => unknown) | null
  ) => Promise.resolve({ data, error: null }).then(onFulfilled ?? undefined);
  return obj;
}

function makeService(
  rpc: ReturnType<typeof vi.fn>,
  get: ReturnType<typeof vi.fn>
): IntelligenceFeedService {
  const supabaseStub = { client: { rpc } } as unknown as SupabaseService;
  const cacheStub = { get, invalidateTags: vi.fn() } as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new IntelligenceFeedService());
}

describe('IntelligenceFeedService.list', () => {
  it('caches under the space intelligence + events tags', async () => {
    const get = vi.fn().mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0 });
    const service = makeService(vi.fn(), get);

    await service.list({ spaceId: 'space-1' });

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('list_intelligence_feed');
    expect(params).toMatchObject({ spaceId: 'space-1' });
    expect(opts.tags).toEqual(['space:space-1:primary-intelligence', 'space:space-1:events']);
  });

  it('maps options to the RPC params (kinds, categories, since, query, paging)', async () => {
    // Run the real fetch closure so we assert the actual RPC params.
    const get = vi.fn((_name, _params, opts) => opts.fetch());
    const rpc = vi.fn().mockReturnValue(makeRpcResult({ rows: [], total: 0, limit: 10, offset: 5 }));
    const service = makeService(rpc, get);

    await service.list({
      spaceId: 's1',
      kinds: ['event'],
      categories: ['Clinical'],
      since: '2026-01-01',
      query: 'x',
      limit: 10,
      offset: 5,
    });

    expect(rpc).toHaveBeenCalledWith('list_intelligence_feed', {
      p_space_id: 's1',
      p_kinds: ['event'],
      p_categories: ['Clinical'],
      p_since: '2026-01-01',
      p_query: 'x',
      p_limit: 10,
      p_offset: 5,
    });
  });

  it('defaults nullable params to null and paging to 25/0', async () => {
    const get = vi.fn((_name, _params, opts) => opts.fetch());
    const rpc = vi.fn().mockReturnValue(makeRpcResult({ rows: [], total: 0, limit: 25, offset: 0 }));
    const service = makeService(rpc, get);

    await service.list({ spaceId: 's1' });

    expect(rpc).toHaveBeenCalledWith('list_intelligence_feed', {
      p_space_id: 's1',
      p_kinds: null,
      p_categories: null,
      p_since: null,
      p_query: null,
      p_limit: 25,
      p_offset: 0,
    });
  });
});
