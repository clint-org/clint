/**
 * Unit tests for CompanyService. Focus is the new cascade-safety surface
 * (previewDelete) plus regression coverage for the existing CRUD methods
 * so future refactors don't silently break the wiring contract.
 *
 * CompanyService uses inject(SupabaseService) and inject(RpcCache) at
 * field-initializer time. The vitest.units.config.ts runner uses a plain
 * node environment, so we skip TestBed and instead build a small Injector
 * with stub services whose .client / .get / .invalidateTags are vi.fn().
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CompanyService } from './company.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface QueryBuilderStub {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
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
    order: vi.fn(),
    single: vi.fn(),
    throwOnError: vi.fn(),
    _data: data,
    _error: error,
  };
  // Every chainable method returns the same builder. Both the terminal
  // .single() and a top-level await on the builder resolve with { data, error }.
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
  qb.insert.mockReturnValue(qb);
  qb.update.mockReturnValue(qb);
  qb.delete.mockReturnValue(qb);
  qb.eq.mockReturnValue(qb);
  qb.order.mockReturnValue(qb);
  qb.throwOnError.mockReturnValue(qb);
  qb.single.mockReturnValue(qb);
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
  auth: { getUser: ReturnType<typeof vi.fn> };
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub, cache: CacheStub): CompanyService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new CompanyService());
}

describe('CompanyService.previewDelete', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: CompanyService;

  beforeEach(() => {
    rpc = vi.fn();
    service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
  });

  it('calls preview_company_delete RPC with p_company_id and returns the count breakdown', async () => {
    const breakdown = { products: 2, trials: 5, events: 3 };
    rpc.mockReturnValueOnce(makeRpcResult(breakdown));

    const result = await service.previewDelete('company-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('preview_company_delete', { p_company_id: 'company-1' });
    expect(result).toEqual(breakdown);
  });

  it('returns an empty object when data is null', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null));
    const result = await service.previewDelete('company-1');
    expect(result).toEqual({});
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null, { message: '42501' }));
    await expect(service.previewDelete('company-1')).rejects.toMatchObject({ message: '42501' });
  });
});

describe('CompanyService.delete', () => {
  it('queries the existing row to get space_id, then deletes, then invalidates cache tags', async () => {
    // The existing-row lookup and the delete both run against .from('companies').
    // Use a fresh qb per call so we can assert each invocation's chain.
    const lookupQb = makeQueryBuilder({ space_id: 'space-7' });
    const deleteQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('company-id');

    expect(from).toHaveBeenCalledWith('companies');
    expect(lookupQb.select).toHaveBeenCalledWith('space_id');
    expect(lookupQb.eq).toHaveBeenCalledWith('id', 'company-id');
    expect(deleteQb.delete).toHaveBeenCalled();
    expect(deleteQb.eq).toHaveBeenCalledWith('id', 'company-id');
    expect(invalidateTags).toHaveBeenCalledWith([
      'space:space-7:companies',
      'space:space-7:dashboard',
      'space:space-7:landing-stats',
    ]);
  });

  it('throws when the delete query yields an error', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-7' });
    const deleteQb = makeQueryBuilder(null, { message: 'rls' });
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.delete('company-id')).rejects.toMatchObject({ message: 'rls' });
  });
});

describe('CompanyService.list', () => {
  it('delegates to RpcCache.get with the list_companies key and per-space tag', async () => {
    const get = vi.fn().mockResolvedValue([{ id: 'a' }]);
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.list('space-1');

    expect(get).toHaveBeenCalledTimes(1);
    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('list_companies');
    expect(params).toEqual({ spaceId: 'space-1' });
    expect(opts.tags).toEqual(['space:space-1:companies']);
    expect(result).toEqual([{ id: 'a' }]);
  });
});

describe('CompanyService.getById', () => {
  it('queries .from(companies).select(...).eq(id, ...).single() and returns data', async () => {
    const qb = makeQueryBuilder({ id: 'c-1', name: 'Acme' });
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    const result = await service.getById('c-1');

    expect(from).toHaveBeenCalledWith('companies');
    expect(qb.eq).toHaveBeenCalledWith('id', 'c-1');
    expect(qb.single).toHaveBeenCalled();
    expect(result).toEqual({ id: 'c-1', name: 'Acme' });
  });
});
