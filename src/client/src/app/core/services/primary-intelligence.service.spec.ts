import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { UpsertIntelligenceInput } from '../models/primary-intelligence.model';
import { PrimaryIntelligenceService } from './primary-intelligence.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface ClientStub {
  rpc: ReturnType<typeof vi.fn>;
  from?: ReturnType<typeof vi.fn>;
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

/** Creates a chainable stub for .from().select().eq().single() calls. */
function makeFromChain(data: unknown): {
  fromSpy: ReturnType<typeof vi.fn>;
  selectSpy: ReturnType<typeof vi.fn>;
} {
  const singleSpy = vi.fn().mockResolvedValue({ data, error: null });
  const eqSpy = vi.fn().mockReturnValue({ single: singleSpy });
  const selectSpy = vi.fn().mockReturnValue({ eq: eqSpy });
  const fromSpy = vi.fn().mockReturnValue({ select: selectSpy });
  return { fromSpy, selectSpy };
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

const baseInput: UpsertIntelligenceInput = {
  id: null,
  anchor_id: null,
  space_id: 'space-1',
  entity_type: 'trial',
  entity_id: 'trial-1',
  headline: 'Test',
  summary_md: '',
  implications_md: '',
  state: 'draft',
  change_note: null,
  links: [],
};

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
        p_referencing_entity_type: 'event',
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

describe('PrimaryIntelligenceService anchor-aware mutations', () => {
  it('upsert sends p_anchor_id', async () => {
    const rpcSpy = vi.fn().mockReturnValue(makeRpcResult('new-id'));
    const invalidateSpy = vi.fn();
    const service = makeService({ rpc: rpcSpy }, { get: vi.fn(), invalidateTags: invalidateSpy });
    await service.upsert({ ...baseInput, anchor_id: 'anc-1' });
    expect(rpcSpy).toHaveBeenCalledWith(
      'upsert_primary_intelligence',
      expect.objectContaining({ p_anchor_id: 'anc-1' })
    );
  });

  it('setLead calls set_intelligence_lead and invalidates the detail tag', async () => {
    const rpcSpy = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateSpy = vi.fn();
    const service = makeService({ rpc: rpcSpy }, { get: vi.fn(), invalidateTags: invalidateSpy });
    await service.setLead('anc-1', 'space-1', 'trial', 'trial-1');
    expect(rpcSpy).toHaveBeenCalledWith('set_intelligence_lead', { p_anchor_id: 'anc-1' });
    expect(invalidateSpy).toHaveBeenCalledWith(expect.arrayContaining(['trial:trial-1:detail']));
  });

  it('reorder calls reorder_intelligence with the anchor id array', async () => {
    const rpcSpy = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateSpy = vi.fn();
    const service = makeService({ rpc: rpcSpy }, { get: vi.fn(), invalidateTags: invalidateSpy });
    await service.reorder('space-1', 'trial', 'trial-1', ['anc-2', 'anc-1']);
    expect(rpcSpy).toHaveBeenCalledWith('reorder_intelligence', {
      p_space_id: 'space-1',
      p_entity_type: 'trial',
      p_entity_id: 'trial-1',
      p_anchor_ids: ['anc-2', 'anc-1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith(expect.arrayContaining(['trial:trial-1:detail']));
  });

  it('loadHistory calls get_primary_intelligence_history with p_anchor_id', async () => {
    const historyPayload = { current: null, draft: null, versions: [], events: [] };
    const get = vi
      .fn()
      .mockImplementation((_rpc, _params, opts: { fetch: () => Promise<unknown> }) => opts.fetch());
    const rpcSpy = vi.fn().mockReturnValue(makeRpcResult(historyPayload));
    const service = makeService({ rpc: rpcSpy }, { get, invalidateTags: vi.fn() });
    await service.loadHistory('anc-1', 'trial', 'trial-1');
    expect(rpcSpy).toHaveBeenCalledWith('get_primary_intelligence_history', { p_anchor_id: 'anc-1' });
  });
});

describe('PrimaryIntelligenceService delete/withdraw/purge anchor join', () => {
  const anchorData = {
    space_id: 'space-1',
    primary_intelligence_anchors: { entity_type: 'trial', entity_id: 'trial-1' },
  };

  it('delete uses the anchor-joined select and invalidates the nested entity tags', async () => {
    const { fromSpy, selectSpy } = makeFromChain(anchorData);
    const rpcSpy = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateSpy = vi.fn();
    const service = makeService(
      { rpc: rpcSpy, from: fromSpy },
      { get: vi.fn(), invalidateTags: invalidateSpy }
    );
    await service.delete('pi-1');
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('primary_intelligence_anchors'));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.arrayContaining(['trial:trial-1:detail']));
  });

  it('withdraw uses the anchor-joined select', async () => {
    const { fromSpy, selectSpy } = makeFromChain(anchorData);
    const rpcSpy = vi.fn().mockReturnValue(makeRpcResult(null));
    const service = makeService(
      { rpc: rpcSpy, from: fromSpy },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
    await service.withdraw('pi-1', 'reason');
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('primary_intelligence_anchors'));
  });

  it('purge uses the anchor-joined select', async () => {
    const { fromSpy, selectSpy } = makeFromChain(anchorData);
    const rpcSpy = vi.fn().mockReturnValue(makeRpcResult(null));
    const service = makeService(
      { rpc: rpcSpy, from: fromSpy },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
    await service.purge('pi-1', 'CONFIRM');
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('primary_intelligence_anchors'));
  });
});
