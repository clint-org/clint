import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { MarkerService } from './marker.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface QueryBuilderStub {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  throwOnError: ReturnType<typeof vi.fn>;
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
    single: vi.fn(),
    throwOnError: vi.fn(),
    _data: data,
    _error: error,
  };
  const chain = qb as unknown as PromiseLike<{ data: unknown; error: unknown }>;
  (chain as { then: PromiseLike<unknown>['then'] }).then = (
    onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null
  ) => {
    if (qb._error) return Promise.reject(qb._error).then(null, onRejected);
    return Promise.resolve({ data: qb._data, error: qb._error }).then(onFulfilled ?? undefined);
  };
  qb.select.mockReturnValue(qb);
  qb.insert.mockReturnValue(qb);
  qb.update.mockReturnValue(qb);
  qb.delete.mockReturnValue(qb);
  qb.eq.mockReturnValue(qb);
  qb.throwOnError.mockReturnValue(qb);
  qb.single.mockImplementation(() => {
    const s = { throwOnError: vi.fn() } as Record<string, unknown>;
    const sp = s as unknown as PromiseLike<{ data: unknown; error: unknown }>;
    (sp as { then: PromiseLike<unknown>['then'] }).then = (
      onFulfilled?: ((v: { data: unknown; error: unknown }) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null
    ) => {
      if (qb._error) return Promise.reject(qb._error).then(null, onRejected);
      return Promise.resolve({ data: qb._data, error: qb._error }).then(onFulfilled ?? undefined);
    };
    s['throwOnError'] = vi.fn().mockReturnValue(sp);
    return sp;
  });
  return qb;
}

interface ClientStub {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  auth: { getUser: ReturnType<typeof vi.fn>; getSession: ReturnType<typeof vi.fn> };
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub, cache: CacheStub): MarkerService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new MarkerService());
}

describe('MarkerService.update', () => {
  it('invalidates the catalyst detail tag for the updated marker', async () => {
    const updateQb = makeQueryBuilder({ id: 'marker-1', space_id: 'space-1' });
    const assignmentsQb = makeQueryBuilder([{ trial_id: 'trial-1' }]);
    const from = vi.fn().mockReturnValueOnce(assignmentsQb).mockReturnValueOnce(updateQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.update('marker-1', { type_id: 'type-x' });

    expect(invalidateTags).toHaveBeenCalledTimes(1);
    expect(invalidateTags.mock.calls[0][0]).toContain('catalyst:marker-1:detail');
  });
});

describe('MarkerService.updateAssignments', () => {
  it('delegates to update_marker_assignments RPC and invalidates affected tags', async () => {
    const markerQb = makeQueryBuilder({ space_id: 'space-1' });
    const oldRowsQb = makeQueryBuilder([{ trial_id: 'trial-old' }]);
    const from = vi.fn().mockReturnValueOnce(markerQb).mockReturnValueOnce(oldRowsQb);
    const rpc = vi.fn().mockReturnValue({
      throwOnError: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.updateAssignments('marker-1', ['trial-new']);

    expect(rpc).toHaveBeenCalledWith('update_marker_assignments', {
      p_marker_id: 'marker-1',
      p_trial_ids: ['trial-new'],
    });
    expect(invalidateTags).toHaveBeenCalledTimes(1);
    const tags = invalidateTags.mock.calls[0][0] as string[];
    expect(tags).toContain('catalyst:marker-1:detail');
    // Both previous and new trial caches get invalidated.
    expect(tags).toContain('trial:trial-old:detail');
    expect(tags).toContain('trial:trial-new:detail');
  });
});

describe('MarkerService.delete', () => {
  it('invalidates the catalyst detail tag for the deleted marker', async () => {
    const markerQb = makeQueryBuilder({ space_id: 'space-1' });
    const assignmentsQb = makeQueryBuilder([{ trial_id: 'trial-1' }]);
    const deleteQb = makeQueryBuilder(null);
    const from = vi
      .fn()
      .mockReturnValueOnce(markerQb)
      .mockReturnValueOnce(assignmentsQb)
      .mockReturnValueOnce(deleteQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('marker-1');

    expect(invalidateTags).toHaveBeenCalledTimes(1);
    expect(invalidateTags.mock.calls[0][0]).toContain('catalyst:marker-1:detail');
  });
});
