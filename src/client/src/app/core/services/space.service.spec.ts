/**
 * Unit tests for SpaceService.archive/restore/permanentlyDelete plus the
 * archived_at filter on list / listArchived.
 *
 * SpaceService uses inject(SupabaseService) at field-initializer time, so
 * the service must be constructed inside an Angular injection context.
 * The vitest.units.config.ts runner uses a plain node environment, so we
 * skip TestBed and instead build a small Injector with a stub
 * SupabaseService whose .client is a vi.fn-tracked chain.
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SpaceService } from './space.service';
import { SupabaseService } from './supabase.service';

interface QueryBuilderStub {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  throwOnError: ReturnType<typeof vi.fn>;
  // Terminal: thenable resolution. Set per test.
  _data: unknown;
  _error: unknown;
}

function makeQueryBuilder(data: unknown, error: unknown = null): QueryBuilderStub {
  const qb: QueryBuilderStub = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    throwOnError: vi.fn(),
    _data: data,
    _error: error,
  };
  // Each chainable call returns the same builder. The terminal step is
  // .order() which the SpaceService awaits; we expose a then() on the
  // builder so the await resolves with { data, error }.
  // throwOnError is also chainable; when _error is non-null the thenable rejects.
  const chain = qb as unknown as PromiseLike<{ data: unknown; error: unknown }>;
  (chain as { then: PromiseLike<unknown>['then'] }).then = (
    onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null,
  ) => {
    if (qb._error) return Promise.reject(qb._error).then(null, onRejected);
    return Promise.resolve({ data: qb._data, error: qb._error }).then(onFulfilled ?? undefined);
  };
  qb.select.mockReturnValue(qb);
  qb.eq.mockReturnValue(qb);
  qb.is.mockReturnValue(qb);
  qb.not.mockReturnValue(qb);
  qb.order.mockReturnValue(qb);
  qb.throwOnError.mockReturnValue(qb);
  return qb;
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

interface ClientStub {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub): SpaceService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const injector = Injector.create({
    providers: [{ provide: SupabaseService, useValue: supabaseStub }],
  });
  return runInInjectionContext(injector, () => new SpaceService());
}

describe('SpaceService.archiveSpace', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: SpaceService;

  beforeEach(() => {
    rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    service = makeService({ from: vi.fn(), rpc });
  });

  it('calls the archive_space RPC with p_space_id', async () => {
    await service.archiveSpace('space-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('archive_space', { p_space_id: 'space-1' });
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null, { message: 'denied' }));
    await expect(service.archiveSpace('space-1')).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('SpaceService.restoreSpace', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: SpaceService;

  beforeEach(() => {
    rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    service = makeService({ from: vi.fn(), rpc });
  });

  it('calls the restore_space RPC with p_space_id', async () => {
    await service.restoreSpace('space-2');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('restore_space', { p_space_id: 'space-2' });
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null, { message: 'not archived' }));
    await expect(service.restoreSpace('space-2')).rejects.toMatchObject({ message: 'not archived' });
  });
});

describe('SpaceService.permanentlyDeleteSpace', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: SpaceService;

  beforeEach(() => {
    rpc = vi.fn();
    service = makeService({ from: vi.fn(), rpc });
  });

  it('calls the permanently_delete_space RPC and returns the count breakdown', async () => {
    const breakdown = { name: 'Acme', companies: 2, trials: 7 };
    rpc.mockReturnValueOnce(makeRpcResult(breakdown));

    const result = await service.permanentlyDeleteSpace('space-3');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('permanently_delete_space', { p_space_id: 'space-3' });
    expect(result).toEqual(breakdown);
  });

  it('returns an empty object when data is null', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null));
    const result = await service.permanentlyDeleteSpace('space-3');
    expect(result).toEqual({});
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null, { message: 'must archive first' }));
    await expect(service.permanentlyDeleteSpace('space-3')).rejects.toMatchObject({
      message: 'must archive first',
    });
  });
});

describe('SpaceService.listSpaces', () => {
  it('filters archived_at is null and selects from spaces ordered by created_at', async () => {
    const qb = makeQueryBuilder([{ id: 'a' }, { id: 'b' }]);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService({ from, rpc: vi.fn() });

    const result = await service.listSpaces('tenant-1');

    expect(from).toHaveBeenCalledWith('spaces');
    expect(qb.select).toHaveBeenCalledWith('*');
    expect(qb.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(qb.is).toHaveBeenCalledWith('archived_at', null);
    expect(qb.order).toHaveBeenCalledWith('created_at');
    expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('returns [] when the query yields a null data field', async () => {
    const qb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService({ from, rpc: vi.fn() });

    const result = await service.listSpaces('tenant-1');
    expect(result).toEqual([]);
  });

  it('throws when the query yields an error', async () => {
    const qb = makeQueryBuilder(null, { message: 'rls' });
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService({ from, rpc: vi.fn() });

    await expect(service.listSpaces('tenant-1')).rejects.toMatchObject({ message: 'rls' });
  });
});

describe('SpaceService.listArchivedSpaces', () => {
  it('filters archived_at is not null and orders by archived_at descending', async () => {
    const qb = makeQueryBuilder([{ id: 'arc-1', archived_at: '2026-05-20T00:00:00Z' }]);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService({ from, rpc: vi.fn() });

    const result = await service.listArchivedSpaces('tenant-1');

    expect(from).toHaveBeenCalledWith('spaces');
    expect(qb.select).toHaveBeenCalledWith('*');
    expect(qb.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(qb.not).toHaveBeenCalledWith('archived_at', 'is', null);
    expect(qb.order).toHaveBeenCalledWith('archived_at', { ascending: false });
    expect(result).toEqual([{ id: 'arc-1', archived_at: '2026-05-20T00:00:00Z' }]);
  });

  it('returns [] when the query yields a null data field', async () => {
    const qb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService({ from, rpc: vi.fn() });

    const result = await service.listArchivedSpaces('tenant-1');
    expect(result).toEqual([]);
  });

  it('throws when the query yields an error', async () => {
    const qb = makeQueryBuilder(null, { message: 'rls' });
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService({ from, rpc: vi.fn() });

    await expect(service.listArchivedSpaces('tenant-1')).rejects.toMatchObject({ message: 'rls' });
  });
});
