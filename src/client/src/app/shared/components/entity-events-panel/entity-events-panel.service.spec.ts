import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { EntityEventsPanelService, FetchEntityEventsParams } from './entity-events-panel.service';
import { RpcCache } from '../../../core/services/rpc-cache.service';
import { SupabaseService } from '../../../core/services/supabase.service';

function makeService(
  rpc: ReturnType<typeof vi.fn>,
  get: ReturnType<typeof vi.fn>
): EntityEventsPanelService {
  const supabaseStub = { client: { rpc, from: vi.fn(), auth: { getUser: vi.fn() } } } as unknown as SupabaseService;
  const cacheStub = { get, invalidateTags: vi.fn() } as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new EntityEventsPanelService());
}

describe('EntityEventsPanelService.fetch', () => {
  it('routes through cache.get with get_events_page_data and the space events tag', async () => {
    const get = vi.fn().mockResolvedValue([]);
    const service = makeService(vi.fn(), get);

    const params: FetchEntityEventsParams = {
      spaceId: 'space-1',
      entityLevel: 'trial',
      entityId: 'trial-1',
      limit: 10,
    };

    await service.fetch(params);

    const [rpcName, cacheParams, opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_events_page_data');
    expect(cacheParams).toEqual(params);
    expect(opts.tags).toEqual(['space:space-1:events']);
  });

  it('returns the data from cache.get', async () => {
    const rows = [{ id: 'ev-1', title: 'Event 1' }];
    const get = vi.fn().mockResolvedValue(rows);
    const service = makeService(vi.fn(), get);

    const result = await service.fetch({
      spaceId: 'space-2',
      entityLevel: 'company',
      entityId: 'company-1',
    });

    expect(result).toEqual(rows);
  });

  it('unwraps items from the rpc payload when the fetch callback is invoked', async () => {
    const rows = [{ id: 'ev-1', title: 'Event 1' }];
    const rpc = vi.fn().mockResolvedValue({ data: { items: rows, total: 1 }, error: null });
    const get = vi.fn().mockImplementation(async (_name: string, _params: unknown, opts: { fetch: () => Promise<unknown> }) => {
      return opts.fetch();
    });
    const service = makeService(rpc, get);

    const result = await service.fetch({ spaceId: 'space-1', entityLevel: 'trial', entityId: 'trial-1' });

    expect(rpc).toHaveBeenCalledWith('get_events_page_data', expect.objectContaining({
      p_space_id: 'space-1',
      p_entity_level: 'trial',
      p_entity_id: 'trial-1',
    }));
    // The RPC returns { items, total }; the service must unwrap to the items array.
    expect(result).toEqual(rows);
  });
});
