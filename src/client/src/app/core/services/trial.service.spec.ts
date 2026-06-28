/**
 * Unit tests for TrialService. Focus is the new cascade-safety surface
 * (previewDelete) plus regression coverage for the existing CRUD methods.
 *
 * The mapEventToMarker and TRIAL_SELECT exports are tested as pure contracts so
 * the event->Marker mapping can be verified without mounting Supabase.
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TrialService, mapEventToMarker, TRIAL_SELECT } from './trial.service';
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
  in: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
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
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    in: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
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
  qb.or.mockReturnValue(qb);
  qb.order.mockReturnValue(qb);
  qb.limit.mockReturnValue(qb);
  qb.in.mockReturnValue(qb);
  qb.throwOnError.mockReturnValue(qb);
  qb.single.mockImplementation(() => {
    const s = { throwOnError: vi.fn() } as Record<string, unknown>;
    const sp = s as unknown as PromiseLike<{ data: unknown; error: unknown }>;
    (sp as { then: PromiseLike<unknown>['then'] }).then = (
      onFulfilled?: ((v: { data: unknown; error: unknown }) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
    ) => {
      if (qb._error) return Promise.reject(qb._error).then(null, onRejected);
      return Promise.resolve({ data: qb._data, error: qb._error }).then(onFulfilled ?? undefined);
    };
    s['throwOnError'] = vi.fn().mockReturnValue(sp);
    return sp;
  });
  qb.maybeSingle.mockImplementation(() => {
    const s = { throwOnError: vi.fn() } as Record<string, unknown>;
    const sp = s as unknown as PromiseLike<{ data: unknown; error: unknown }>;
    (sp as { then: PromiseLike<unknown>['then'] }).then = (
      onFulfilled?: ((v: { data: unknown; error: unknown }) => unknown) | null,
      onRejected?: ((r: unknown) => unknown) | null,
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

function makeService(client: ClientStub, cache: CacheStub): TrialService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const cacheStub = cache as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: RpcCache, useValue: cacheStub },
    ],
  });
  return runInInjectionContext(injector, () => new TrialService());
}

describe('TrialService.previewDelete', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: TrialService;

  beforeEach(() => {
    rpc = vi.fn();
    service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
  });

  it('calls preview_trial_delete RPC with p_trial_id and returns the breakdown', async () => {
    const breakdown = {
      trial_notes: 2,
      events: 1,
      marker_assignments: 2,
      markers_removed_entirely: 1,
      markers_unlinked_only: 1,
    };
    rpc.mockReturnValueOnce(makeRpcResult(breakdown));

    const result = await service.previewDelete('trial-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('preview_trial_delete', { p_trial_id: 'trial-1' });
    expect(result).toEqual(breakdown);
  });

  it('returns an empty object when data is null', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null));
    const result = await service.previewDelete('trial-1');
    expect(result).toEqual({});
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null, { message: '42501' }));
    await expect(service.previewDelete('trial-1')).rejects.toMatchObject({ message: '42501' });
  });
});

describe('TrialService.delete', () => {
  it('queries the existing row, deletes from trials, and invalidates trial + asset cache tags', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1', asset_id: 'asset-1' });
    const deleteQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('trial-1');

    expect(from).toHaveBeenCalledWith('trials');
    expect(lookupQb.eq).toHaveBeenCalledWith('id', 'trial-1');
    expect(deleteQb.delete).toHaveBeenCalled();
    expect(deleteQb.eq).toHaveBeenCalledWith('id', 'trial-1');
    expect(invalidateTags).toHaveBeenCalledWith([
      'space:space-1:trials',
      'space:space-1:dashboard',
      'space:space-1:activity',
      'space:space-1:landing-stats',
      'trial:trial-1:detail',
      'trial:trial-1:activity',
      'asset:asset-1:trials',
    ]);
  });

  it('throws when the delete query yields an error', async () => {
    const lookupQb = makeQueryBuilder({ space_id: 'space-1', asset_id: 'asset-1' });
    const deleteQb = makeQueryBuilder(null, { message: 'rls' });
    const from = vi.fn().mockReturnValueOnce(lookupQb).mockReturnValueOnce(deleteQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.delete('trial-1')).rejects.toMatchObject({ message: 'rls' });
  });
});

describe('TrialService.listByAsset', () => {
  it('delegates to RpcCache.get with the trials_by_asset key and per-asset tag', async () => {
    const get = vi.fn().mockResolvedValue([{ id: 't-1', name: 'Trial 1' }]);
    const service = makeService(
      { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get, invalidateTags: vi.fn() }
    );

    const result = await service.listByAsset('asset-1');

    const [rpcName, params, opts] = get.mock.calls[0];
    expect(rpcName).toBe('trials_by_asset');
    expect(params).toEqual({ assetId: 'asset-1' });
    expect(opts.tags).toEqual(['asset:asset-1:trials']);
    expect(result).toEqual([{ id: 't-1', name: 'Trial 1' }]);
  });
});

describe('TrialService.create', () => {
  function setup(newId = 'new-trial-id') {
    const captured: Record<string, unknown> = {};
    const rpc = vi.fn((name: string, params: Record<string, unknown>) => {
      if (name === 'create_trial') Object.assign(captured, params);
      return makeRpcResult(newId);
    });
    // getById round-trip after create: one from('trials') then one from('events').
    const getByIdQb = makeQueryBuilder({
      id: newId,
      space_id: 'space-1',
      asset_id: 'asset-1',
    });
    const eventsQb = makeQueryBuilder([]);
    const from = vi.fn()
      .mockReturnValueOnce(getByIdQb)
      .mockReturnValue(eventsQb);
    const service = makeService(
      { from, rpc, auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
    return { service, captured };
  }

  it('passes the explicit phase dates as p_phase_start_date / p_phase_end_date', async () => {
    const { service, captured } = setup();
    await service.create(
      'space-1',
      { asset_id: 'asset-1', name: 'Trial', identifier: 'NCT00000001', phase_type: 'P2' },
      '2024-01-01',
      '2025-06-30',
    );
    expect(captured['p_space_id']).toBe('space-1');
    expect(captured['p_asset_id']).toBe('asset-1');
    expect(captured['p_name']).toBe('Trial');
    expect(captured['p_phase_type']).toBe('P2');
    expect(captured['p_phase_start_date']).toBe('2024-01-01');
    expect(captured['p_phase_end_date']).toBe('2025-06-30');
  });


  it('defaults phase dates to null when omitted', async () => {
    const { service, captured } = setup();
    await service.create('space-1', { asset_id: 'asset-1', name: 'Trial' });
    expect(captured['p_phase_start_date']).toBeNull();
    expect(captured['p_phase_end_date']).toBeNull();
  });
});

describe('TrialService.update with phase fields', () => {
  function setup(updateReturn: Record<string, unknown> = { id: 't1', space_id: 'space-1' }) {
    const captured: Record<string, unknown> = {};
    const updateQb = makeQueryBuilder(updateReturn);
    const originalUpdate = updateQb.update;
    updateQb.update = vi.fn((payload: Record<string, unknown>) => {
      Object.assign(captured, payload);
      return originalUpdate(payload);
    });
    const from = vi.fn().mockReturnValue(updateQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );
    return { service, captured };
  }

  it('writes phase_type_source=analyst when caller supplies phase_type without a source', async () => {
    const { service, captured } = setup();
    await service.update('t1', { phase_type: 'P2' });
    expect(captured['phase_type']).toBe('P2');
    expect(captured['phase_type_source']).toBe('analyst');
  });

  it('never writes the dropped trial-date columns or their source columns', async () => {
    const { service, captured } = setup();
    // Trial dates are markers now; update must not touch them even by name.
    await service.update('t1', { phase_type: 'P3', name: 'renamed' });
    expect(captured['phase_type_source']).toBe('analyst');
    expect(captured).not.toHaveProperty('phase_start_date');
    expect(captured).not.toHaveProperty('phase_end_date');
    expect(captured).not.toHaveProperty('phase_start_date_source');
    expect(captured).not.toHaveProperty('phase_end_date_source');
  });

  it('does not touch source columns when caller omits phase fields', async () => {
    const { service, captured } = setup();
    await service.update('t1', { name: 'renamed' });
    expect(captured).not.toHaveProperty('phase_type_source');
  });

  it('respects caller-provided source over default analyst', async () => {
    const { service, captured } = setup();
    await service.update('t1', { phase_type: 'P2', phase_type_source: 'ctgov' });
    expect(captured['phase_type_source']).toBe('ctgov');
  });
});

describe('TrialService.listBySpace preclinical filtering', () => {
  // RpcCache shim runs the fetch closure so we exercise the PostgREST query build.
  // from is called twice when trials are returned: once for trials, once for events.
  function setup(rows: unknown[]) {
    const qb = makeQueryBuilder(rows);
    const eventsQb = makeQueryBuilder([]);
    const from = vi.fn()
      .mockReturnValueOnce(qb)
      .mockReturnValue(eventsQb);
    const cacheGet = vi.fn().mockImplementation((_name, _params, opts) => opts.fetch());
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: cacheGet, invalidateTags: vi.fn() }
    );
    return { service, from, qb, eventsQb, cacheGet };
  }

  it('omits the preclinical filter and keys the cache as tracking when showPreclinical=true', async () => {
    const { service, from, qb, cacheGet } = setup([{ id: 't1' }]);

    await service.listBySpace('space-1', true);

    expect(from).toHaveBeenCalledWith('trials');
    expect(qb.eq).toHaveBeenCalledWith('space_id', 'space-1');
    expect(qb.or).not.toHaveBeenCalled();
    expect(qb.order).toHaveBeenCalledWith('display_order');
    expect(cacheGet.mock.calls[0][1]).toEqual({ spaceId: 'space-1', showPreclinical: true });
  });

  it('applies the Postgres-executed .or filter (keeping null-phase rows) when not tracked', async () => {
    const { service, qb, cacheGet } = setup([]);

    await service.listBySpace('space-1', false);

    expect(qb.or).toHaveBeenCalledWith('phase_type.is.null,phase_type.neq.PRECLIN');
    expect(qb.order).toHaveBeenCalledWith('display_order');
    expect(cacheGet.mock.calls[0][1]).toEqual({ spaceId: 'space-1', showPreclinical: false });
  });

  it('defaults to tracking (no filter) when the flag is omitted', async () => {
    const { service, qb } = setup([]);
    await service.listBySpace('space-1');
    expect(qb.or).not.toHaveBeenCalled();
  });
});

describe('TrialService.setIndications', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let invalidateTags: ReturnType<typeof vi.fn>;
  let service: TrialService;

  beforeEach(() => {
    rpc = vi.fn();
    invalidateTags = vi.fn();
    service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags },
    );
  });

  it('calls set_trial_indications RPC with correct params', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null));

    await service.setIndications('trial-1', ['ind-a', 'ind-b'], 'space-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('set_trial_indications', {
      p_trial_id: 'trial-1',
      p_indication_ids: ['ind-a', 'ind-b'],
    });
  });

  it('invalidates the expected cache tags including :indications', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null));

    await service.setIndications('trial-1', ['ind-a'], 'space-1');

    expect(invalidateTags).toHaveBeenCalledWith([
      'space:space-1:trials',
      'space:space-1:dashboard',
      'space:space-1:activity',
      'space:space-1:landing-stats',
      'space:space-1:indications',
      'trial:trial-1:detail',
    ]);
  });
});

describe('TrialService.listIndications', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: TrialService;

  beforeEach(() => {
    rpc = vi.fn();
    service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() },
    );
  });

  it('calls get_trial_indications RPC and maps indication_id/indication_name to id/name', async () => {
    rpc.mockReturnValueOnce(
      makeRpcResult([
        { indication_id: 'ind-a', indication_name: 'NSCLC' },
        { indication_id: 'ind-b', indication_name: 'SCLC' },
      ]),
    );

    const result = await service.listIndications('trial-1');

    expect(rpc).toHaveBeenCalledWith('get_trial_indications', { p_trial_id: 'trial-1' });
    expect(result).toEqual([
      { id: 'ind-a', name: 'NSCLC' },
      { id: 'ind-b', name: 'SCLC' },
    ]);
  });

  it('returns an empty array when data is null', async () => {
    rpc.mockReturnValueOnce(makeRpcResult(null));

    const result = await service.listIndications('trial-1');

    expect(result).toEqual([]);
  });
});

describe('TrialService.getLatestSnapshotsForSpace', () => {
  it('calls list_latest_snapshots_for_space RPC and returns a Map keyed by trial_id', async () => {
    const rpc = vi.fn().mockReturnValue(makeRpcResult([
        { trial_id: 't-1', payload: { x: 1 } },
        { trial_id: 't-2', payload: { x: 2 } },
      ]));
    // The RpcCache shim delegates straight to the fetch callback so we
    // exercise the real RPC call path.
    const cacheGet = vi.fn().mockImplementation((_name, _params, opts) => opts.fetch());
    const service = makeService(
      { from: vi.fn(), rpc, auth: { getUser: vi.fn() } },
      { get: cacheGet, invalidateTags: vi.fn() }
    );

    const result = await service.getLatestSnapshotsForSpace('space-1');

    expect(rpc).toHaveBeenCalledWith('list_latest_snapshots_for_space', { p_space_id: 'space-1' });
    expect(result.size).toBe(2);
    expect(result.get('t-1')).toEqual({ x: 1 });
    expect(result.get('t-2')).toEqual({ x: 2 });
  });
});

// ---------------------------------------------------------------------------
// New tests for the events schema cutover (Stage 1 / Phase B)
// ---------------------------------------------------------------------------

describe('TRIAL_SELECT', () => {
  it('does not embed marker_assignments (those tables were dropped in Stage 1)', () => {
    expect(TRIAL_SELECT).not.toContain('marker_assignments');
  });

  it('retains the assets embed for the phase-bar and manage page', () => {
    expect(TRIAL_SELECT).toContain('assets!trials_asset_id_fkey');
  });
});

describe('mapEventToMarker', () => {
  const baseEvent: Record<string, unknown> = {
    id: 'event-1',
    space_id: 'space-1',
    anchor_id: 'trial-1',
    anchor_type: 'trial',
    created_by: 'user-1',
    event_type_id: 'et-1',
    title: 'Phase 2 Data Readout',
    projection: 'actual',
    event_date: '2024-06-01',
    date_precision: 'day',
    end_date: null,
    end_date_precision: 'day',
    is_ongoing: false,
    description: 'Topline P2 results',
    source_url: null,
    metadata: null,
    is_projected: false,
    no_longer_expected: false,
    significance: 'high',
    visibility: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    updated_by: null,
    event_types: {
      id: 'et-1',
      name: 'Data Readout',
      category_id: 'cat-1',
      event_type_categories: {
        id: 'cat-1',
        name: 'Clinical Readout',
      },
    },
  };

  it('renames event_type_id to marker_type_id', () => {
    const marker = mapEventToMarker(baseEvent);
    expect(marker.marker_type_id).toBe('et-1');
  });

  it('renames event_types to marker_types', () => {
    const marker = mapEventToMarker(baseEvent);
    expect(marker.marker_types).toBeDefined();
    expect(marker.marker_types!.id).toBe('et-1');
    expect(marker.marker_types!.name).toBe('Data Readout');
  });

  it('renames event_type_categories to marker_categories inside marker_types', () => {
    const marker = mapEventToMarker(baseEvent);
    expect(marker.marker_types!.marker_categories).toEqual({
      id: 'cat-1',
      name: 'Clinical Readout',
    });
  });

  it('preserves other Marker fields unchanged', () => {
    const marker = mapEventToMarker(baseEvent);
    expect(marker.id).toBe('event-1');
    expect(marker.title).toBe('Phase 2 Data Readout');
    expect(marker.significance).toBe('high');
    expect(marker.is_projected).toBe(false);
    expect(marker.event_date).toBe('2024-06-01');
  });

  it('sets marker_types to null when event_types is null', () => {
    const marker = mapEventToMarker({ ...baseEvent, event_types: null });
    expect(marker.marker_types).toBeNull();
  });

  it('sets marker_categories to null when event_type_categories is null', () => {
    const event = {
      ...baseEvent,
      event_types: { id: 'et-1', name: 'Data Readout', event_type_categories: null },
    };
    const marker = mapEventToMarker(event);
    expect(marker.marker_types!.marker_categories).toBeNull();
  });
});

describe('TrialService.listBySpace event merging', () => {
  function setupWithEvents(trialRows: unknown[], eventRows: unknown[] = []) {
    const trialsQb = makeQueryBuilder(trialRows);
    const eventsQb = makeQueryBuilder(eventRows);
    const from = vi.fn()
      .mockReturnValueOnce(trialsQb)
      .mockReturnValue(eventsQb);
    const cacheGet = vi.fn().mockImplementation((_name, _params, opts) => opts.fetch());
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn() } },
      { get: cacheGet, invalidateTags: vi.fn() },
    );
    return { service, from, trialsQb, eventsQb };
  }

  it('queries the events table with anchor_type=trial and the returned trial ids', async () => {
    const { service, from, eventsQb } = setupWithEvents([{ id: 't-1', space_id: 'space-1' }]);

    await service.listBySpace('space-1');

    expect(from).toHaveBeenCalledWith('events');
    expect(eventsQb.eq).toHaveBeenCalledWith('anchor_type', 'trial');
    expect(eventsQb.in).toHaveBeenCalledWith('anchor_id', ['t-1']);
  });

  it('attaches mapped events as markers on the matching trial', async () => {
    const eventRow = {
      id: 'ev-1',
      space_id: 'space-1',
      anchor_id: 't-1',
      anchor_type: 'trial',
      created_by: 'user-1',
      event_type_id: 'et-1',
      title: 'Data Readout',
      projection: 'actual',
      event_date: '2025-01-01',
      date_precision: 'day',
      end_date: null,
      end_date_precision: 'day',
      is_ongoing: false,
      description: null,
      source_url: null,
      metadata: null,
      is_projected: false,
      no_longer_expected: false,
      significance: null,
      visibility: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      updated_by: null,
      event_types: {
        id: 'et-1',
        name: 'DR',
        event_type_categories: { id: 'cat-1', name: 'Clinical' },
      },
    };

    const { service } = setupWithEvents(
      [{ id: 't-1', space_id: 'space-1' }],
      [eventRow],
    );

    const trials = await service.listBySpace('space-1');

    expect(trials[0].markers).toHaveLength(1);
    expect(trials[0].markers![0].marker_type_id).toBe('et-1');
    expect(trials[0].markers![0].marker_types?.marker_categories).toEqual({
      id: 'cat-1',
      name: 'Clinical',
    });
  });

  it('skips the events query when no trials are returned', async () => {
    const { service, from } = setupWithEvents([]);

    await service.listBySpace('space-1');

    expect(from).not.toHaveBeenCalledWith('events');
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('leaves markers empty when no events are anchored to a trial', async () => {
    const { service } = setupWithEvents([{ id: 't-1', space_id: 'space-1' }], []);

    const trials = await service.listBySpace('space-1');

    expect(trials[0].markers).toEqual([]);
  });
});
