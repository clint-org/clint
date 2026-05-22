/**
 * Unit tests for TrialService. Focus is the new cascade-safety surface
 * (previewDelete) plus regression coverage for the existing CRUD methods.
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TrialService } from './trial.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface QueryBuilderStub {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  _data: unknown;
  _error: unknown;
}

function makeQueryBuilder(data: unknown, error: unknown = null): QueryBuilderStub {
  const qb: QueryBuilderStub = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    _data: data,
    _error: error,
  };
  const chain = qb as unknown as PromiseLike<{ data: unknown; error: unknown }>;
  (chain as { then: PromiseLike<unknown>['then'] }).then = (
    onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null
  ) => Promise.resolve({ data: qb._data, error: qb._error }).then(onFulfilled ?? undefined);
  qb.select.mockReturnValue(qb);
  qb.insert.mockReturnValue(qb);
  qb.update.mockReturnValue(qb);
  qb.delete.mockReturnValue(qb);
  qb.eq.mockReturnValue(qb);
  qb.order.mockReturnValue(qb);
  qb.limit.mockReturnValue(qb);
  qb.single.mockResolvedValue({ data: qb._data, error: qb._error });
  qb.maybeSingle.mockResolvedValue({ data: qb._data, error: qb._error });
  return qb;
}

interface ClientStub {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  auth: { getUser: ReturnType<typeof vi.fn> };
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub, cache: CacheStub): TrialService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new TrialService());
}

describe('TrialService.previewDelete', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: TrialService;

  beforeEach(() => {
    rpc = vi.fn();
    service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
  });

  it('calls preview_trial_delete RPC with p_trial_id and returns the breakdown', async () => {
    const breakdown = {
      trial_notes: 2,
      events: 1,
      marker_assignments: 2,
      markers_removed_entirely: 1,
      markers_unlinked_only: 1,
    };
    rpc.mockResolvedValueOnce({ data: breakdown, error: null });

    const result = await service.previewDelete('trial-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('preview_trial_delete', { p_trial_id: 'trial-1' });
    expect(result).toEqual(breakdown);
  });

  it('returns an empty object when data is null', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const result = await service.previewDelete('trial-1');
    expect(result).toEqual({});
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: '42501' } });
    await expect(service.previewDelete('trial-1')).rejects.toMatchObject({ message: '42501' });
  });
});

describe('TrialService.delete', () => {
  it('queries the existing row, deletes from trials, and invalidates trial + asset cache tags', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1', product_id: 'asset-1' });
    const deleteQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('trial-1');

    expect(from).toHaveBeenCalledWith('trials');
    expect(lookupQb.eq).toHaveBeenCalledWith('id', 'trial-1');
    expect(deleteQb.delete).toHaveBeenCalled();
    expect(deleteQb.eq).toHaveBeenCalledWith('id', 'trial-1');
    expect(invalidateTags).toHaveBeenCalledWith([
      'space:space-1:trials',
      'space:space-1:dashboard',
      'space:space-1:activity',
      'space:space-1:landing-stats',
      'trial:trial-1:detail',
      'trial:trial-1:activity',
      'asset:asset-1:trials',
    ]);
  });

  it('throws when the delete query yields an error', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1', product_id: 'asset-1' });
    const deleteQb = makeQueryBuilder(null, { message: 'rls' });
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.delete('trial-1')).rejects.toMatchObject({ message: 'rls' });
  });
});

describe('TrialService.listByAsset', () => {
  it('delegates to RpcCache.get with the trials_by_asset key and per-asset tag', async () => {
    const get = vi.fn().mockResolvedValue([{ id: 't-1', name: 'Trial 1' }]);
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.listByAsset('asset-1');

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('trials_by_asset');
    expect(params).toEqual({ assetId: 'asset-1' });
    expect(opts.tags).toEqual(['asset:asset-1:trials']);
    expect(result).toEqual([{ id: 't-1', name: 'Trial 1' }]);
  });
});

describe('TrialService.update with phase fields', () => {
  function setup(updateReturn: Record<string, unknown> = { id: 't1', space_id: 'space-1' }) {
    const captured: Record<string, unknown> = {};
    const updateQb = makeQueryBuilder(updateReturn);
    const originalUpdate = updateQb.update;
    updateQb.update = vi.fn((payload: Record<string, unknown>) => {
      Object.assign(captured, payload);
      return originalUpdate(payload);
    });
    const from = vi.fn().mockReturnValue(updateQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
    return { service, captured };
  }

  it('writes phase_type_source=analyst when caller supplies phase_type without a source', async () => {
    const { service, captured } = setup();
    await service.update('t1', { phase_type: 'P2' });
    expect(captured['phase_type']).toBe('P2');
    expect(captured['phase_type_source']).toBe('analyst');
  });

  it('writes all three sources when caller supplies all three fields', async () => {
    const { service, captured } = setup();
    await service.update('t1', {
      phase_type: 'P3',
      phase_start_date: '2024-01-01',
      phase_end_date: '2025-06-30',
    });
    expect(captured['phase_type_source']).toBe('analyst');
    expect(captured['phase_start_date_source']).toBe('analyst');
    expect(captured['phase_end_date_source']).toBe('analyst');
  });

  it('does not touch source columns when caller omits phase fields', async () => {
    const { service, captured } = setup();
    await service.update('t1', { name: 'renamed' });
    expect(captured).not.toHaveProperty('phase_type_source');
    expect(captured).not.toHaveProperty('phase_start_date_source');
    expect(captured).not.toHaveProperty('phase_end_date_source');
  });

  it('respects caller-provided source over default analyst', async () => {
    const { service, captured } = setup();
    await service.update('t1', { phase_type: 'P2', phase_type_source: 'ctgov' });
    expect(captured['phase_type_source']).toBe('ctgov');
  });
});

describe('TrialService.getLatestSnapshotsForSpace', () => {
  it('calls list_latest_snapshots_for_space RPC and returns a Map keyed by trial_id', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { trial_id: 't-1', payload: { x: 1 } },
        { trial_id: 't-2', payload: { x: 2 } },
      ],
      error: null,
    });
    // The RpcCache shim delegates straight to the fetch callback so we
    // exercise the real RPC call path.
    const cacheGet = vi.fn().mockImplementation((_name, _params, opts) => opts.fetch());
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: cacheGet, invalidateTags: vi.fn() }
    );

    const result = await service.getLatestSnapshotsForSpace('space-1');

    expect(rpc).toHaveBeenCalledWith('list_latest_snapshots_for_space', { p_space_id: 'space-1' });
    expect(result.size).toBe(2);
    expect(result.get('t-1')).toEqual({ x: 1 });
    expect(result.get('t-2')).toEqual({ x: 2 });
  });
});
