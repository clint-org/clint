/**
 * Unit tests for SpaceSettingsService. Like CompanyService, it uses
 * inject(SupabaseService) at field-initializer time, so we build a small
 * Injector with a stub SupabaseService whose .client.from / .client.rpc are
 * vi.fn() (no TestBed; the vitest runner is a plain node environment).
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { SpaceSettingsService } from './space-settings.service';
import { SupabaseService } from './supabase.service';

interface QueryBuilderStub {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  throwOnError: ReturnType<typeof vi.fn>;
  _data: unknown;
  _error: unknown;
}

function makeQueryBuilder(data: unknown, error: unknown = null): QueryBuilderStub {
  const qb: QueryBuilderStub = {
    select: vi.fn(),
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
  qb.eq.mockReturnValue(qb);
  qb.single.mockReturnValue(qb);
  qb.throwOnError.mockReturnValue(qb);
  return qb;
}

function makeRpcResult(data: unknown, error: unknown = null) {
  const obj = { throwOnError: vi.fn() };
  obj.throwOnError.mockReturnValue(obj);
  const t = obj as unknown as PromiseLike<{ data: unknown; error: unknown }>;
  (t as { then: PromiseLike<unknown>['then'] }).then = (
    onFulfilled?: ((v: { data: unknown; error: unknown }) => unknown) | null,
    onRejected?: ((r: unknown) => unknown) | null
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

function makeService(client: ClientStub): SpaceSettingsService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const injector = Injector.create({
    providers: [{ provide: SupabaseService, useValue: supabaseStub }],
  });
  return runInInjectionContext(injector, () => new SpaceSettingsService());
}

describe('SpaceSettingsService.getShowPreclinical', () => {
  it('selects show_preclinical for the space and returns true when set', async () => {
    const qb = makeQueryBuilder({ show_preclinical: true });
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService({ from, rpc: vi.fn() });

    const result = await service.getShowPreclinical('space-1');

    expect(from).toHaveBeenCalledWith('spaces');
    expect(qb.select).toHaveBeenCalledWith('show_preclinical');
    expect(qb.eq).toHaveBeenCalledWith('id', 'space-1');
    expect(qb.single).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('coerces a falsy/missing flag to false', async () => {
    const qb = makeQueryBuilder({ show_preclinical: false });
    const service = makeService({ from: vi.fn().mockReturnValue(qb), rpc: vi.fn() });
    expect(await service.getShowPreclinical('space-1')).toBe(false);

    const nullQb = makeQueryBuilder(null);
    const service2 = makeService({ from: vi.fn().mockReturnValue(nullQb), rpc: vi.fn() });
    expect(await service2.getShowPreclinical('space-1')).toBe(false);
  });
});

describe('SpaceSettingsService.setShowPreclinical', () => {
  it('calls the owner-gated update_space_show_preclinical RPC with the flag', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    const service = makeService({ from: vi.fn(), rpc });

    await service.setShowPreclinical('space-1', true);

    expect(rpc).toHaveBeenCalledWith('update_space_show_preclinical', {
      p_space_id: 'space-1',
      p_show: true,
    });
  });

  it('propagates an RLS/forbidden error from the RPC', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null, { message: '42501' }));
    const service = makeService({ from: vi.fn(), rpc });

    await expect(service.setShowPreclinical('space-1', false)).rejects.toMatchObject({
      message: '42501',
    });
  });
});
