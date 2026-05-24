import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { LandscapeService } from './landscape.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface ClientStub {
  rpc: ReturnType<typeof vi.fn>;
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub, cache: CacheStub): LandscapeService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new LandscapeService());
}

describe('LandscapeService.getLandscapeIndex', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let get: ReturnType<typeof vi.fn>;
  let service: LandscapeService;

  beforeEach(() => {
    rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    get = vi.fn().mockResolvedValue([]);
    service = makeService({ rpc }, { get, invalidateTags: vi.fn() });
  });

  it('routes therapeutic-area dimension to get_landscape_index with correct tag', async () => {
    await service.getLandscapeIndex('space-1', 'therapeutic-area');

    const [rpcName, , opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_landscape_index');
    expect(opts.tags).toEqual(['space:space-1:landscape:therapeutic-area']);
  });

  it('routes company dimension to get_landscape_index_by_company with correct tag', async () => {
    await service.getLandscapeIndex('space-1', 'company');

    const [rpcName, , opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_landscape_index_by_company');
    expect(opts.tags).toEqual(['space:space-1:landscape:company']);
  });
});

describe('LandscapeService.getBullseyeData', () => {
  it('builds the right tag including dimension and entityId', async () => {
    const get = vi.fn().mockResolvedValue({});
    const service = makeService(
      { rpc: vi.fn().mockResolvedValue({ data: {}, error: null }) },
      { get, invalidateTags: vi.fn() }
    );

    await service.getBullseyeData('space-1', 'moa', 'entity-42');

    const [rpcName, , opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_bullseye_by_moa');
    expect(opts.tags).toEqual(['space:space-1:bullseye:moa:entity-42']);
  });
});

describe('LandscapeService.getPositioningData', () => {
  it('uses tag space:{id}:positioning, passes all key params, and remaps products->assets', async () => {
    const rawWireResult = { rows: [], count_unit: 'products' };
    const rpc = vi.fn().mockResolvedValue({ data: rawWireResult, error: null });
    // cache.get invokes opts.fetch() directly so the products->assets remap is exercised.
    const get = vi.fn().mockImplementation((_rpcName, _params, opts) => opts.fetch());
    const service = makeService({ rpc }, { get, invalidateTags: vi.fn() });

    const filters = {
      companyIds: ['c-1'],
      assetIds: [],
      indicationIds: [],
      mechanismOfActionIds: [],
      routeOfAdministrationIds: [],
      phases: [],
      recruitmentStatuses: [],
      studyTypes: [],
    };

    const result = await service.getPositioningData('space-1', 'company', 'assets', filters);

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_positioning_data');
    expect(opts.tags).toEqual(['space:space-1:positioning']);
    expect(params).toMatchObject({ spaceId: 'space-1', grouping: 'company', countUnit: 'assets', filters });
    // Inverse remap: wire value 'products' must come back as 'assets'.
    expect(result.count_unit).toBe('assets');
  });
});
