import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { PrimaryIntelligenceService } from './primary-intelligence.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface ClientStub {
  rpc: ReturnType<typeof vi.fn>;
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeRpcResult(data: unknown) {
  const obj = { throwOnError: vi.fn() };
  obj.throwOnError.mockReturnValue(obj);
  const t = obj as unknown as { then: PromiseLike<unknown>['then'] };
  t.then = (onFulfilled?: ((v: { data: unknown; error: unknown }) => unknown) | null) =>
    Promise.resolve({ data, error: null }).then(onFulfilled ?? undefined);
  return obj;
}

function makeService(client: ClientStub, cache: CacheStub): PrimaryIntelligenceService {
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: { client } as unknown as SupabaseService },
      { provide: RpcCache, useValue: cache as unknown as RpcCache },
    ],
  });
  return runInInjectionContext(injector, () => new PrimaryIntelligenceService());
}

describe('PrimaryIntelligenceService.getMarkerReferences', () => {
  it('queries list_primary_intelligence with marker referencing params and maps to PiReference', async () => {
    const rpc = vi.fn().mockReturnValue(
      makeRpcResult({
        rows: [
          {
            id: 'pi1',
            entity_type: 'trial',
            entity_id: 't1',
            headline: 'Cites this catalyst',
            state: 'published',
            summary_md: '',
            last_edited_by: 'u',
            updated_at: 'now',
            links: [],
            contributors: [],
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      })
    );
    // cache.get just runs the fetch callback so the supabase rpc is exercised.
    const get = vi
      .fn()
      .mockImplementation((_rpc, _params, opts: { fetch: () => Promise<unknown> }) => opts.fetch());

    const service = makeService({ rpc }, { get, invalidateTags: vi.fn() });
    const refs = await service.getMarkerReferences('space1', 'marker1');

    expect(rpc).toHaveBeenCalledWith(
      'list_primary_intelligence',
      expect.objectContaining({
        p_space_id: 'space1',
        p_referencing_entity_type: 'marker',
        p_referencing_entity_id: 'marker1',
      })
    );
    expect(refs).toEqual([
      { id: 'pi1', entity_type: 'trial', entity_id: 't1', entity_name: null, headline: 'Cites this catalyst' },
    ]);
  });

  it('returns an empty list when there are no referencing entries', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult({ rows: [], total: 0, limit: 50, offset: 0 }));
    const get = vi
      .fn()
      .mockImplementation((_rpc, _params, opts: { fetch: () => Promise<unknown> }) => opts.fetch());

    const service = makeService({ rpc }, { get, invalidateTags: vi.fn() });
    const refs = await service.getMarkerReferences('space1', 'marker1');
    expect(refs).toEqual([]);
  });
});
