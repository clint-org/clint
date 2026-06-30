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

/** A raw events-table row with its event type nested, as Supabase returns it. */
function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'marker-1',
    space_id: 'space-1',
    anchor_type: 'trial',
    anchor_id: 'trial-1',
    event_type_id: 'type-1',
    title: 'Topline readout',
    event_types: {
      id: 'type-1',
      name: 'Data Readout',
      event_type_categories: { id: 'cat-1', name: 'Clinical Data' },
    },
    ...overrides,
  };
}

describe('MarkerService.create', () => {
  it('inserts a single-anchor trial event via create_event and returns the getById read', async () => {
    const getByIdQb = makeQueryBuilder(eventRow());
    const from = vi.fn().mockReturnValueOnce(getByIdQb);
    const rpc = vi.fn().mockReturnValue({
      throwOnError: vi.fn().mockResolvedValue({ data: 'marker-1', error: null }),
    });
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    const created = await service.create(
      'space-1',
      {
        marker_type_id: 'type-1',
        title: 'Topline readout',
        projection: 'actual',
        event_date: '2026-07-01',
        source_url: 'https://example.com/readout',
      },
      'trial-1'
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpc.mock.calls[0];
    expect(fnName).toBe('create_event');
    expect(params).toMatchObject({
      p_space_id: 'space-1',
      p_event_type_id: 'type-1',
      p_title: 'Topline readout',
      p_event_date: '2026-07-01',
      p_anchor_type: 'trial',
      p_anchor_id: 'trial-1',
      p_projection: 'actual',
    });
    // The single Source URL field maps to ONE citation via p_sources; the
    // legacy scalar p_source_url is no longer passed.
    expect(params.p_sources).toEqual([{ url: 'https://example.com/readout', label: null }]);
    expect(params.p_source_url).toBeUndefined();
    // No metadata supplied -> no follow-up events update, only the getById read.
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('events');
    // Returned value is the mapped getById row (event_type_id -> marker_type_id).
    expect(created.marker_type_id).toBe('type-1');
    // Trial-detail cache invalidated for the single anchor.
    expect(invalidateTags.mock.calls[0][0]).toContain('trial:trial-1:detail');
    // Markers drive bullseye/heatmap/landscape positioning; the umbrella tag
    // invalidates those so they refresh after a marker write (#177).
    expect(invalidateTags.mock.calls[0][0]).toContain('space:space-1:landscape-all');
  });

  it('writes metadata with a follow-up events update when supplied', async () => {
    const metadataQb = makeQueryBuilder(null);
    const getByIdQb = makeQueryBuilder(eventRow());
    const from = vi.fn().mockReturnValueOnce(metadataQb).mockReturnValueOnce(getByIdQb);
    const rpc = vi.fn().mockReturnValue({
      throwOnError: vi.fn().mockResolvedValue({ data: 'marker-1', error: null }),
    });
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.create(
      'space-1',
      {
        marker_type_id: 'type-1',
        title: 'FDA Submission',
        projection: 'actual',
        event_date: '2026-07-01',
        metadata: { pathway: 'priority' },
      },
      'trial-1'
    );

    expect(from).toHaveBeenCalledTimes(2);
    expect(metadataQb.update).toHaveBeenCalledWith({ metadata: { pathway: 'priority' } });
    expect(metadataQb.eq).toHaveBeenCalledWith('id', 'marker-1');
    // No source URL supplied -> p_sources is null (no citation created).
    expect(rpc.mock.calls[0][1].p_sources).toBeNull();
  });
});

describe('MarkerService.update', () => {
  it('updates the events row inline and renames marker_type_id to event_type_id', async () => {
    const updateQb = makeQueryBuilder(eventRow({ id: 'marker-1', space_id: 'space-1' }));
    const from = vi.fn().mockReturnValueOnce(updateQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.update('marker-1', { marker_type_id: 'type-2', event_date: '2026-08-01' });

    expect(from).toHaveBeenCalledWith('events');
    const mapped = updateQb.update.mock.calls[0][0] as Record<string, unknown>;
    expect(mapped).toEqual({ event_type_id: 'type-2', event_date: '2026-08-01' });
    expect(mapped['marker_type_id']).toBeUndefined();
    expect(invalidateTags.mock.calls[0][0]).toContain('catalyst:marker-1:detail');
    expect(invalidateTags.mock.calls[0][0]).toContain('space:space-1:landscape-all');
  });

  it('passes through scalar changes and invalidates the anchor trial cache', async () => {
    const updateQb = makeQueryBuilder(eventRow({ id: 'marker-1', anchor_id: 'trial-9' }));
    const from = vi.fn().mockReturnValueOnce(updateQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.update('marker-1', { event_date: '2026-09-01', projection: 'company' });

    const mapped = updateQb.update.mock.calls[0][0] as Record<string, unknown>;
    expect(mapped).toEqual({ event_date: '2026-09-01', projection: 'company' });
    expect(invalidateTags.mock.calls[0][0]).toContain('trial:trial-9:detail');
  });

  it('routes a source_url change to update_event_sources and drops it from the inline update', async () => {
    const updateQb = makeQueryBuilder(eventRow({ id: 'marker-1', space_id: 'space-1' }));
    const from = vi.fn().mockReturnValueOnce(updateQb);
    const rpc = vi.fn().mockReturnValue({
      throwOnError: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.update('marker-1', {
      title: 'New title',
      source_url: 'https://example.com/citation',
    });

    // source_url is not an events column anymore: the inline update omits it.
    const mapped = updateQb.update.mock.calls[0][0] as Record<string, unknown>;
    expect(mapped).toEqual({ title: 'New title' });
    expect(mapped['source_url']).toBeUndefined();

    // The single citation is replaced via update_event_sources.
    expect(rpc).toHaveBeenCalledWith('update_event_sources', {
      p_event_id: 'marker-1',
      p_urls: ['https://example.com/citation'],
      p_labels: [null],
    });
  });

  it('clears the citation when source_url is set to empty', async () => {
    const updateQb = makeQueryBuilder(eventRow({ id: 'marker-1', space_id: 'space-1' }));
    const from = vi.fn().mockReturnValueOnce(updateQb);
    const rpc = vi.fn().mockReturnValue({
      throwOnError: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await service.update('marker-1', { title: 'New title', source_url: '' });

    expect(rpc).toHaveBeenCalledWith('update_event_sources', {
      p_event_id: 'marker-1',
      p_urls: [],
      p_labels: [],
    });
  });

  it('does not touch event_sources when source_url is absent from the change set', async () => {
    const updateQb = makeQueryBuilder(eventRow({ id: 'marker-1', space_id: 'space-1' }));
    const from = vi.fn().mockReturnValueOnce(updateQb);
    const rpc = vi.fn();
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await service.update('marker-1', { event_date: '2026-09-01' });

    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('MarkerService.delete', () => {
  it('deletes the events row and invalidates the catalyst + anchor tags', async () => {
    const readQb = makeQueryBuilder({ space_id: 'space-1', anchor_id: 'trial-1' });
    const deleteQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValueOnce(readQb).mockReturnValueOnce(deleteQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('marker-1');

    expect(from).toHaveBeenCalledWith('events');
    expect(deleteQb.delete).toHaveBeenCalledTimes(1);
    const tags = invalidateTags.mock.calls[0][0] as string[];
    expect(tags).toContain('catalyst:marker-1:detail');
    expect(tags).toContain('trial:trial-1:detail');
    expect(tags).toContain('space:space-1:landscape-all');
  });
});

describe('MarkerService.getById', () => {
  it('reads from events and maps event_type_id to marker_type_id', async () => {
    const getByIdQb = makeQueryBuilder(eventRow());
    const from = vi.fn().mockReturnValueOnce(getByIdQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    const marker = await service.getById('marker-1');

    expect(from).toHaveBeenCalledWith('events');
    expect(getByIdQb.select).toHaveBeenCalledWith(
      '*, event_types(*, event_type_categories(*)), event_sources(url, label, sort_order)'
    );
    expect(marker?.marker_type_id).toBe('type-1');
    expect(marker?.marker_types?.marker_categories?.name).toBe('Clinical Data');
  });
});
