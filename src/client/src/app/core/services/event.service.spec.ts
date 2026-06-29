import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EventService } from './event.service';
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
  auth: { getUser: ReturnType<typeof vi.fn>; getSession: ReturnType<typeof vi.fn> };
}

interface CacheStub {
  get: ReturnType<typeof vi.fn>;
  invalidateTags: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub, cache: CacheStub): EventService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new EventService());
}

const baseFilters = {
  dateFrom: null,
  dateTo: null,
  entityLevel: null,
  entityId: null,
  categoryNames: [],
  tags: [],
  priority: null,
  sourceType: null,
  search: null,
  sortField: null,
  sortDir: null,
};

describe('EventService.getEventsPageData', () => {
  it('delegates to cache.get with get_events_page_data and space events tag', async () => {
    const get = vi.fn().mockResolvedValue([]);
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    await service.getEventsPageData('space-1', baseFilters);

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_events_page_data');
    expect(params).toMatchObject({ spaceId: 'space-1' });
    expect(opts.tags).toEqual(['space:space-1:events']);
  });

  it('maps category names to p_category_names (never the uuid p_category_ids)', async () => {
    // Run the real fetch closure so we assert the actual RPC params.
    const get = vi.fn((_name, _params, opts) => opts.fetch());
    const rpc = vi.fn().mockReturnValue(makeRpcResult({ items: [], total: 0 }));
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    await service.getEventsPageData('space-1', {
      ...baseFilters,
      categoryNames: ['Regulatory', 'Catalyst lifecycle'],
    });

    const [, params] = rpc.mock.calls[0];
    expect(params.p_category_names).toEqual(['Regulatory', 'Catalyst lifecycle']);
    expect(params).not.toHaveProperty('p_category_ids');
  });

  it('sends null p_category_names when no category filter is set', async () => {
    const get = vi.fn((_name, _params, opts) => opts.fetch());
    const rpc = vi.fn().mockReturnValue(makeRpcResult({ items: [], total: 0 }));
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    await service.getEventsPageData('space-1', baseFilters);

    const [, params] = rpc.mock.calls[0];
    expect(params.p_category_names).toBeNull();
  });

  it('maps the server overview aggregates (snake_case) onto the result', async () => {
    const get = vi.fn((_name, _params, opts) => opts.fetch());
    const rpc = vi.fn().mockReturnValue(
      makeRpcResult({
        items: [{ id: 'e1' }],
        total: 27,
        high_priority_count: 4,
        distribution: [{ name: 'Approval', count: 27 }],
        recent: [{ id: 'r1' }],
      })
    );
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.getEventsPageData('space-1', baseFilters);

    expect(result.total).toBe(27);
    expect(result.highPriorityCount).toBe(4);
    expect(result.distribution).toEqual([{ name: 'Approval', count: 27 }]);
    expect(result.recent).toEqual([{ id: 'r1' }]);
  });

  it('defaults the overview aggregates when the RPC omits them', async () => {
    const get = vi.fn((_name, _params, opts) => opts.fetch());
    const rpc = vi.fn().mockReturnValue(makeRpcResult({ items: [], total: 0 }));
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.getEventsPageData('space-1', baseFilters);

    expect(result.highPriorityCount).toBe(0);
    expect(result.distribution).toEqual([]);
    expect(result.recent).toEqual([]);
  });
});

describe('EventService.getEventDetail', () => {
  it('delegates to cache.get with get_event_detail and event detail tag', async () => {
    const get = vi.fn().mockResolvedValue({});
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    await service.getEventDetail('event-1');

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_event_detail');
    expect(params).toEqual({ eventId: 'event-1' });
    expect(opts.tags).toEqual(['event:event-1:detail']);
  });
});

describe('EventService.getSpaceTags', () => {
  it('delegates to cache.get with get_space_tags and space tags tag', async () => {
    const get = vi.fn().mockResolvedValue([]);
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    await service.getSpaceTags('space-1');

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('get_space_tags');
    expect(params).toEqual({ spaceId: 'space-1' });
    expect(opts.tags).toEqual(['space:space-1:tags']);
  });
});

describe('EventService.create', () => {
  let from: ReturnType<typeof vi.fn>;
  let rpc: ReturnType<typeof vi.fn>;
  let invalidateTags: ReturnType<typeof vi.fn>;
  let service: EventService;

  beforeEach(() => {
    const eventQb = makeQueryBuilder({ id: 'event-1', space_id: 'space-1' });
    const insertQb = makeQueryBuilder(null);
    from = vi.fn().mockImplementation((table: string) => {
      if (table === 'events') return eventQb;
      return insertQb;
    });
    rpc = vi.fn().mockReturnValue(makeRpcResult('event-1'));
    invalidateTags = vi.fn();
    service = makeService(
      {
        from,
        rpc,
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
          getSession: vi.fn(),
        },
      },
      { get: vi.fn(), invalidateTags }
    );
  });

  it('invalidates space events and tags after create', async () => {
    await service.create(
      'space-1',
      { title: 'New Event', category_id: 'cat-1', event_date: '2026-01-01' },
      [],
      []
    );

    expect(rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({
        p_space_id: 'space-1',
        p_title: 'New Event',
      })
    );
    expect(invalidateTags).toHaveBeenCalledWith(['space:space-1:events', 'space:space-1:tags']);
  });
});

describe('EventService.update', () => {
  it('invalidates event detail and space tags using the returned row space_id', async () => {
    const qb = makeQueryBuilder({ id: 'event-1', space_id: 'space-2' });
    const from = vi.fn().mockReturnValue(qb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.update('event-1', { title: 'Updated' });

    expect(invalidateTags).toHaveBeenCalledWith([
      'event:event-1:detail',
      'space:space-2:events',
      'space:space-2:tags',
    ]);
  });
});

describe('EventService.updateSources', () => {
  it('delegates to update_event_sources RPC with paired url/label arrays and invalidates event detail', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.updateSources('event-1', [
      { url: 'https://a.example', label: 'A' },
      { url: 'https://b.example', label: '' },
    ]);

    expect(rpc).toHaveBeenCalledWith('update_event_sources', {
      p_event_id: 'event-1',
      p_urls: ['https://a.example', 'https://b.example'],
      p_labels: ['A', ''],
    });
    expect(invalidateTags).toHaveBeenCalledWith(['event:event-1:detail']);
  });

  it('passes empty arrays through (clear-all)', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.updateSources('event-1', []);

    expect(rpc).toHaveBeenCalledWith('update_event_sources', {
      p_event_id: 'event-1',
      p_urls: [],
      p_labels: [],
    });
  });
});

describe('EventService.updateLinks', () => {
  it('delegates to update_event_links RPC and invalidates event detail', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.updateLinks('event-1', ['event-2', 'event-3']);

    expect(rpc).toHaveBeenCalledWith('update_event_links', {
      p_event_id: 'event-1',
      p_linked_event_ids: ['event-2', 'event-3'],
    });
    expect(invalidateTags).toHaveBeenCalledWith(['event:event-1:detail']);
  });

  it('passes empty array through (clear-all outgoing)', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.updateLinks('event-1', []);

    expect(rpc).toHaveBeenCalledWith('update_event_links', {
      p_event_id: 'event-1',
      p_linked_event_ids: [],
    });
  });
});

describe('EventService.nextThreadOrder', () => {
  it('returns max existing thread_order + 1 for a populated thread', async () => {
    const qb = makeQueryBuilder([{ thread_order: 3 }]);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    const next = await service.nextThreadOrder('thread-1');

    expect(from).toHaveBeenCalledWith('events');
    expect(qb.eq).toHaveBeenCalledWith('thread_id', 'thread-1');
    expect(qb.order).toHaveBeenCalledWith('thread_order', { ascending: false, nullsFirst: false });
    expect(next).toBe(4);
  });

  it('returns 1 for an empty thread', async () => {
    const qb = makeQueryBuilder([]);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    expect(await service.nextThreadOrder('thread-1')).toBe(1);
  });

  it('treats a null max thread_order as position 0 (next is 1)', async () => {
    const qb = makeQueryBuilder([{ thread_order: null }]);
    const from = vi.fn().mockReturnValue(qb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    expect(await service.nextThreadOrder('thread-1')).toBe(1);
  });
});

describe('EventService.delete', () => {
  it('looks up space_id before delete and invalidates space + event tags', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-3' });
    const deleteQb = makeQueryBuilder(null);
    const from = vi
      .fn()
      .mockReturnValueOnce(lookupQb as unknown as ReturnType<typeof from>)
      .mockReturnValueOnce(deleteQb as unknown as ReturnType<typeof from>);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('event-1');

    expect(from).toHaveBeenCalledWith('events');
    expect(invalidateTags).toHaveBeenCalledWith([
      'event:event-1:detail',
      'space:space-3:events',
      'space:space-3:tags',
    ]);
  });

  it('throws when lookup returns an error', async () => {
    const lookupQb = makeQueryBuilder(null, { message: 'not found' });
    const from = vi.fn().mockReturnValue(lookupQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.delete('event-1')).rejects.toMatchObject({ message: 'not found' });
  });

  it('throws when row is not found', async () => {
    const lookupQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValue(lookupQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.delete('event-1')).rejects.toThrow('event event-1 not found');
  });
});

describe('EventService.createEvent (unified)', () => {
  it('calls create_event with p_space_id + the unified args incl. p_sources, returns the new id', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult('new-id'));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    const id = await service.createEvent('space-1', {
      p_event_type_id: 'et-1',
      p_title: 'Readout',
      p_event_date: '2026-09-15',
      p_anchor_type: 'trial',
      p_anchor_id: 'tr-1',
      p_projection: 'forecasted',
      p_date_precision: 'exact',
      p_end_date: null,
      p_end_date_precision: 'exact',
      p_is_ongoing: false,
      p_description: null,
      p_significance: null,
      p_visibility: null,
      p_sources: [{ url: 'https://a.test', label: 'A' }],
    });

    expect(id).toBe('new-id');
    const [name, params] = rpc.mock.calls[0];
    expect(name).toBe('create_event');
    expect(params).toMatchObject({
      p_space_id: 'space-1',
      p_event_type_id: 'et-1',
      p_anchor_type: 'trial',
      p_projection: 'forecasted',
      p_sources: [{ url: 'https://a.test', label: 'A' }],
    });
    expect(invalidateTags).toHaveBeenCalledWith(['space:space-1:events', 'space:space-1:tags']);
  });
});

describe('EventService.updateEvent (unified)', () => {
  it('calls update_event with p_event_id + args (incl. type/anchor re-anchor) and invalidates caches', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult(null));
    const invalidateTags = vi.fn();
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.updateEvent('space-1', 'event-1', {
      p_event_type_id: 'et-2',
      p_anchor_type: 'company',
      p_anchor_id: 'co-1',
      p_title: 'Edited',
      p_event_date: '2026-10-01',
      p_projection: 'actual',
      p_date_precision: 'exact',
      p_end_date: null,
      p_end_date_precision: 'exact',
      p_is_ongoing: false,
      p_description: null,
      p_significance: 'high',
      p_visibility: null,
      p_no_longer_expected: false,
    });

    const [name, params] = rpc.mock.calls[0];
    expect(name).toBe('update_event');
    expect(params).toMatchObject({
      p_event_id: 'event-1',
      p_event_type_id: 'et-2',
      p_anchor_type: 'company',
      p_anchor_id: 'co-1',
      p_no_longer_expected: false,
    });
    expect(invalidateTags).toHaveBeenCalledWith([
      'event:event-1:detail',
      'space:space-1:events',
      'space:space-1:tags',
    ]);
  });
});
