import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { MarkerCategoryInUseError, MarkerCategoryService } from './marker-category.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface QueryBuilderStub {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  throwOnError: ReturnType<typeof vi.fn>;
  _data: unknown;
  _error: unknown;
}

// Mirrors the chainable PostgREST builder stub in marker.service.spec.ts, with the
// extra order/limit/or links create() walks for the next-display-order query.
function makeQueryBuilder(data: unknown, error: unknown = null): QueryBuilderStub {
  const qb: QueryBuilderStub = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
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
  qb.or.mockReturnValue(qb);
  qb.order.mockReturnValue(qb);
  qb.limit.mockReturnValue(qb);
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
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub, cache: CacheStub): MarkerCategoryService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new MarkerCategoryService());
}

describe('MarkerCategoryService.create', () => {
  it('inserts a custom category with is_system false and order after the current max', async () => {
    const maxQb = makeQueryBuilder([{ display_order: 5 }]);
    const insertQb = makeQueryBuilder({
      id: 'cat-new',
      space_id: 'space-1',
      name: 'Manufacturing',
      display_order: 6,
      is_system: false,
    });
    const from = vi.fn().mockReturnValueOnce(maxQb).mockReturnValueOnce(insertQb);
    const invalidateTags = vi.fn();
    const service = makeService({ from }, { get: vi.fn(), invalidateTags });

    const result = await service.create('space-1', 'Manufacturing');

    expect(insertQb.insert).toHaveBeenCalledWith({
      name: 'Manufacturing',
      space_id: 'space-1',
      is_system: false,
      display_order: 6,
    });
    expect(result.id).toBe('cat-new');
    expect(invalidateTags).toHaveBeenCalledWith(['markers:types']);
  });

  it('starts ordering at 1 when no categories exist', async () => {
    const maxQb = makeQueryBuilder([]);
    const insertQb = makeQueryBuilder({ id: 'cat-1', display_order: 1 });
    const from = vi.fn().mockReturnValueOnce(maxQb).mockReturnValueOnce(insertQb);
    const service = makeService({ from }, { get: vi.fn(), invalidateTags: vi.fn() });

    await service.create('space-1', 'IP');

    expect(insertQb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ display_order: 1 })
    );
  });
});

describe('MarkerCategoryService.delete', () => {
  it('throws MarkerCategoryInUseError on a foreign-key violation', async () => {
    const delQb = makeQueryBuilder(null, { code: '23503', message: 'fk' });
    const from = vi.fn().mockReturnValue(delQb);
    const service = makeService({ from }, { get: vi.fn(), invalidateTags: vi.fn() });

    await expect(service.delete('cat-1')).rejects.toBeInstanceOf(MarkerCategoryInUseError);
  });

  it('invalidates the markers:types tag on success', async () => {
    const delQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValue(delQb);
    const invalidateTags = vi.fn();
    const service = makeService({ from }, { get: vi.fn(), invalidateTags });

    await service.delete('cat-1');

    expect(invalidateTags).toHaveBeenCalledWith(['markers:types']);
  });
});

// Source-contract tests: verify the service reads/writes event_type_categories,
// not the dropped marker_categories table.
describe('MarkerCategoryService -- source table contract', () => {
  it('list queries event_type_categories', async () => {
    const listQb = makeQueryBuilder([]);
    const from = vi.fn().mockReturnValue(listQb);
    // Pass the fetch callback straight through so the from() call executes.
    const get = vi.fn().mockImplementation(
      (_key: unknown, _params: unknown, opts: { fetch: () => Promise<unknown> }) => opts.fetch()
    );
    const service = makeService({ from }, { get, invalidateTags: vi.fn() });

    await service.list('space-1');

    expect(from).toHaveBeenCalledWith('event_type_categories');
    expect(from).not.toHaveBeenCalledWith('marker_categories');
  });

  it('create queries event_type_categories for both the max-order lookup and the insert', async () => {
    const maxQb = makeQueryBuilder([{ display_order: 2 }]);
    const insertQb = makeQueryBuilder({ id: 'cat-x', display_order: 3 });
    const from = vi.fn().mockReturnValueOnce(maxQb).mockReturnValueOnce(insertQb);
    const service = makeService({ from }, { get: vi.fn(), invalidateTags: vi.fn() });

    await service.create('space-1', 'Regulatory');

    const tableNames = from.mock.calls.map((c: unknown[]) => c[0]);
    expect(tableNames).toEqual(['event_type_categories', 'event_type_categories']);
    expect(tableNames).not.toContain('marker_categories');
  });

  it('delete queries event_type_categories', async () => {
    const delQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValue(delQb);
    const service = makeService({ from }, { get: vi.fn(), invalidateTags: vi.fn() });

    await service.delete('cat-1');

    expect(from).toHaveBeenCalledWith('event_type_categories');
    expect(from).not.toHaveBeenCalledWith('marker_categories');
  });
});
