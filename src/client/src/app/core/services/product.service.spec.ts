/**
 * Unit tests for AssetService (called "product.service.spec.ts" in the
 * cascade-safety spec but the service file is asset.service.ts -- the
 * database table is still `products` while the UI vocabulary is "asset").
 *
 * Focus: the new previewDelete surface + regression coverage for the
 * existing CRUD methods.
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AssetService } from './asset.service';
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
  qb.single.mockResolvedValue({ data: qb._data, error: qb._error });
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

function makeService(client: ClientStub, cache: CacheStub): AssetService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new AssetService());
}

describe('AssetService.previewDelete', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: AssetService;

  beforeEach(() => {
    rpc = vi.fn();
    service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
  });

  it('calls preview_product_delete RPC with p_product_id and returns the breakdown', async () => {
    const breakdown = { trials: 3, trial_notes: 4 };
    rpc.mockResolvedValueOnce({ data: breakdown, error: null });

    const result = await service.previewDelete('product-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('preview_product_delete', { p_product_id: 'product-1' });
    expect(result).toEqual(breakdown);
  });

  it('returns an empty object when data is null', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const result = await service.previewDelete('product-1');
    expect(result).toEqual({});
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: '42501' } });
    await expect(service.previewDelete('product-1')).rejects.toMatchObject({ message: '42501' });
  });
});

describe('AssetService.delete', () => {
  it('queries the existing row, deletes from products, and invalidates cache tags', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1' });
    const deleteQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('p-1');

    expect(from).toHaveBeenCalledWith('products');
    expect(lookupQb.eq).toHaveBeenCalledWith('id', 'p-1');
    expect(deleteQb.delete).toHaveBeenCalled();
    expect(deleteQb.eq).toHaveBeenCalledWith('id', 'p-1');
    expect(invalidateTags).toHaveBeenCalledWith([
      'space:space-1:products',
      'space:space-1:companies',
      'space:space-1:dashboard',
      'space:space-1:landing-stats',
    ]);
  });

  it('throws when the delete query yields an error', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1' });
    const deleteQb = makeQueryBuilder(null, { message: 'fk violation' });
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.delete('p-1')).rejects.toMatchObject({ message: 'fk violation' });
  });
});

describe('AssetService.list', () => {
  it('delegates to RpcCache.get with the list_products key and per-space tag', async () => {
    const get = vi.fn().mockResolvedValue([{ id: 'asset-1', name: 'Drug A' }]);
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.list('space-1');

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('list_products');
    expect(params).toEqual({ spaceId: 'space-1' });
    expect(opts.tags).toEqual(['space:space-1:products']);
    expect(result).toEqual([{ id: 'asset-1', name: 'Drug A' }]);
  });
});

describe('AssetService.setMechanisms', () => {
  it('deletes existing rows then inserts new ones and invalidates cache tags', async () => {
    // Three .from() calls: lookup, delete-old, insert-new.
    const lookupQb = makeQueryBuilder({ space_id: 'space-1' });
    const delQb = makeQueryBuilder(null);
    const insQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(delQb).mockReturnValueOnce(insQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.setMechanisms('asset-1', ['moa-1', 'moa-2']);

    expect(from).toHaveBeenNthCalledWith(1, 'products');
    expect(from).toHaveBeenNthCalledWith(2, 'product_mechanisms_of_action');
    expect(from).toHaveBeenNthCalledWith(3, 'product_mechanisms_of_action');
    expect(delQb.delete).toHaveBeenCalled();
    expect(delQb.eq).toHaveBeenCalledWith('product_id', 'asset-1');
    expect(insQb.insert).toHaveBeenCalledWith([
      { product_id: 'asset-1', moa_id: 'moa-1' },
      { product_id: 'asset-1', moa_id: 'moa-2' },
    ]);
    expect(invalidateTags).toHaveBeenCalled();
  });

  it('skips the insert when the new set is empty', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1' });
    const delQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(delQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await service.setMechanisms('asset-1', []);
    expect(from).toHaveBeenCalledTimes(2);
  });
});
