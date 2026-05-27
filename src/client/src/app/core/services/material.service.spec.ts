/**
 * Unit tests for MaterialService. Materials have no preview RPC because
 * the file-cleanup path is the R2 delete-queue trigger; the spec covers
 * the rest of the service surface so the cascade-safety changes don't
 * regress existing wiring.
 *
 * The service also calls fetch() against the Cloudflare Worker for sign
 * upload / download URLs. The unit specs cover the supabase-client paths
 * only; the worker round-trip is mocked through global.fetch in dedicated
 * worker specs (T8).
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MaterialService } from './material.service';
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
  qb.throwOnError.mockReturnValue(qb);
  qb.single.mockImplementation(() =>
    qb._error ? Promise.reject(qb._error) : Promise.resolve({ data: qb._data, error: qb._error })
  );
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
  auth: { getUser: ReturnType<typeof vi.fn>; getSession: ReturnType<typeof vi.fn> };
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub, cache: CacheStub): MaterialService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new MaterialService());
}

describe('MaterialService.delete', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let from: ReturnType<typeof vi.fn>;
  let invalidateTags: ReturnType<typeof vi.fn>;
  let service: MaterialService;

  beforeEach(() => {
    rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    // lookup row carries space_id + nested material_links the service uses to
    // build cache invalidation tags.
    const lookupQb = makeQueryBuilder({
      space_id: 'space-1',
      material_links: [
        { entity_type: 'company', entity_id: 'company-1' },
        { entity_type: 'trial', entity_id: 'trial-1' },
      ],
    });
    from = vi.fn().mockReturnValue(lookupQb);
    invalidateTags = vi.fn();
    service = makeService(
      {
        from,
        rpc,
        auth: { getUser: vi.fn(), getSession: vi.fn() },
      },
      { get: vi.fn(), invalidateTags }
    );
  });

  it('looks up the row, calls delete_material RPC, and invalidates per-entity tags', async () => {
    await service.delete('material-1');

    expect(from).toHaveBeenCalledWith('materials');
    expect(rpc).toHaveBeenCalledWith('delete_material', { p_id: 'material-1' });
    expect(invalidateTags).toHaveBeenCalledWith([
      'space:space-1:materials',
      'space:space-1:activity',
      'entity:company:company-1:materials',
      'entity:trial:trial-1:materials',
    ]);
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null, { message: 'rls' }));
    await expect(service.delete('material-1')).rejects.toMatchObject({ message: 'rls' });
  });
});

describe('MaterialService.finalize', () => {
  it('calls finalize_material RPC and invalidates cache tags', async () => {
    const lookupQb = makeQueryBuilder({
      space_id: 'space-1',
      material_links: [{ entity_type: 'trial', entity_id: 'trial-1' }],
    });
    const from = vi.fn().mockReturnValue(lookupQb);
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.finalize('material-1');

    expect(rpc).toHaveBeenCalledWith('finalize_material', { p_material_id: 'material-1' });
    expect(invalidateTags).toHaveBeenCalled();
  });

  it('throws when the RPC returns an error', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1', material_links: [] });
    const from = vi.fn().mockReturnValue(lookupQb);
    const rpc = vi.fn().mockReturnValueOnce(makeRpcResult(null, { message: 'not uploader' }));
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.finalize('m-1')).rejects.toMatchObject({ message: 'not uploader' });
  });
});

describe('MaterialService.registerMaterial', () => {
  it('calls register_material RPC with the canonical jsonb payload', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult('new-material-id'));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    const result = await service.registerMaterial({
      space_id: 'space-1',
      file_path: 'materials/space-1/m1/file.pdf',
      file_name: 'file.pdf',
      file_size_bytes: 1024,
      mime_type: 'application/pdf',
      material_type: 'briefing',
      title: 'Sample',
      links: [{ entity_type: 'company', entity_id: 'company-1', display_order: 0 }],
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('register_material');
    const params = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_space_id).toBe('space-1');
    expect(params.p_title).toBe('Sample');
    expect(result).toBe('new-material-id');
    expect(invalidateTags).toHaveBeenCalled();
  });

  it('throws when the RPC returns an error', async () => {
    const rpc = vi.fn().mockReturnValueOnce(makeRpcResult(null, { message: 'mime denied' }));
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(
      service.registerMaterial({
        space_id: 'space-1',
        file_path: 'x',
        file_name: 'x',
        file_size_bytes: 1,
        mime_type: 'application/zip',
        material_type: 'briefing',
        title: 'x',
        links: [],
      })
    ).rejects.toMatchObject({ message: 'mime denied' });
  });
});

describe('MaterialService.updateFilePathDirect', () => {
  it('updates materials.file_path via PostgREST .from().update().eq()', async () => {
    const qb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await service.updateFilePathDirect('material-1', 'new/path.pdf');

    expect(from).toHaveBeenCalledWith('materials');
    expect(qb.update).toHaveBeenCalledWith({ file_path: 'new/path.pdf' });
    expect(qb.eq).toHaveBeenCalledWith('id', 'material-1');
  });

  it('throws when the update query yields an error', async () => {
    const qb = makeQueryBuilder(null, { message: 'rls' });
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.updateFilePathDirect('m-1', 'x')).rejects.toMatchObject({ message: 'rls' });
  });
});

describe('MaterialService.listForEntity', () => {
  it('delegates to RpcCache.get with the list_materials_for_entity key and per-entity tag', async () => {
    const get = vi.fn().mockResolvedValue({ rows: [{ id: 'm-1' }] });
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.listForEntity({
      entityType: 'company',
      entityId: 'company-1',
    });

    const [rpcName, , opts] = get.mock.calls[0];
    expect(rpcName).toBe('list_materials_for_entity');
    expect(opts.tags).toEqual(['entity:company:company-1:materials']);
    expect(result).toEqual({ rows: [{ id: 'm-1' }] });
  });
});
