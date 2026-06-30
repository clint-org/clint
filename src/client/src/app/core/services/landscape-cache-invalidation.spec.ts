import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventService } from './event.service';
import { LandscapeService } from './landscape.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

/**
 * Integration guard for issue #177 (follow-up to #175): event/marker writes must
 * invalidate the bullseye / heatmap / landscape reads, which share a coarse
 * per-space umbrella tag (`space:<id>:landscape-all`). Unlike the per-service
 * tag-assertion specs, this wires a REAL RpcCache to the producer and consumer
 * services and checks the actual eviction round-trip: a populated landscape
 * cache entry is dropped by an event/marker write so the next read refetches.
 *
 * Pre-fix, the write tags never include the umbrella, so the cached pre-edit
 * landscape data survives the TTL and these would fail (no refetch).
 */

const SPACE = 'space-1';

/** A thenable that also exposes `.throwOnError()` returning itself. */
function rpcResult(data: unknown) {
  const obj = { throwOnError: vi.fn() } as { throwOnError: ReturnType<typeof vi.fn> };
  obj.throwOnError.mockReturnValue(obj);
  (obj as unknown as { then: PromiseLike<unknown>['then'] }).then = (onFulfilled) =>
    Promise.resolve({ data, error: null }).then(onFulfilled ?? undefined);
  return obj;
}

interface Harness {
  cache: RpcCache;
  landscape: LandscapeService;
  events: EventService;
  /** how many times the heatmap RPC actually executed */
  heatmapFetches: () => number;
}

function makeHarness(): Harness {
  let heatmapFetches = 0;
  const rpc = vi.fn().mockImplementation((name: string) => {
    if (name === 'get_positioning_data') {
      heatmapFetches += 1;
      return rpcResult({ rows: [], count_unit: 'products' });
    }
    // update_event / create_event / etc. resolve with a benign id/null.
    return rpcResult('new-id');
  });
  const client = {
    rpc,
    from: vi.fn(),
    auth: { getUser: vi.fn(), getSession: vi.fn() },
  };
  // Instantiate RpcCache directly (not via a class-token provider): the units
  // suite runs without the Angular JIT compiler, so class-token DI resolution
  // throws. A real RpcCache instance still exercises the genuine eviction path.
  const cache = new RpcCache();
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: { client } as unknown as SupabaseService },
      { provide: RpcCache, useValue: cache },
    ],
  });
  return runInInjectionContext(injector, () => ({
    cache,
    landscape: new LandscapeService(),
    events: new EventService(),
    heatmapFetches: () => heatmapFetches,
  }));
}

const FILTERS = {
  companyIds: [],
  assetIds: [],
  indicationIds: [],
  mechanismOfActionIds: [],
  routeOfAdministrationIds: [],
  phases: [],
  recruitmentStatuses: [],
  studyTypes: [],
};

async function readHeatmap(h: Harness): Promise<void> {
  await h.landscape.getHeatmapData(SPACE, 'company', 'assets', FILTERS);
}

describe('landscape cache invalidation on event writes (#177)', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it('serves the heatmap from cache on a repeat read (baseline)', async () => {
    await readHeatmap(h);
    await readHeatmap(h);
    // Second read is within the fresh TTL -> no extra RPC.
    expect(h.heatmapFetches()).toBe(1);
  });

  it('updateEvent evicts the heatmap so the next read refetches', async () => {
    await readHeatmap(h);
    expect(h.heatmapFetches()).toBe(1);

    await h.events.updateEvent(SPACE, 'event-1', {
      p_event_type_id: 'et-1',
      p_anchor_type: 'trial',
      p_anchor_id: 'tr-1',
      p_title: 'Edited',
      p_event_date: '2026-10-01',
      p_projection: 'actual',
      p_date_precision: 'exact',
      p_end_date: null,
      p_end_date_precision: 'exact',
      p_is_ongoing: false,
      p_description: null,
      p_significance: null,
      p_visibility: null,
      p_metadata: null,
      p_no_longer_expected: false,
    });

    await readHeatmap(h);
    // The write invalidated space:space-1:landscape-all -> cache miss -> refetch.
    expect(h.heatmapFetches()).toBe(2);
  });

  it('createEvent evicts the heatmap so the next read refetches', async () => {
    await readHeatmap(h);
    await h.events.createEvent(SPACE, {
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
      p_metadata: null,
      p_sources: null,
    });
    await readHeatmap(h);
    expect(h.heatmapFetches()).toBe(2);
  });
});
