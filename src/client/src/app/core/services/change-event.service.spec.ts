import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChangeEventService } from './change-event.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

/**
 * Guard for the timeline PCD-marker stale-cache bug: the async CT.gov sync seeds
 * the trial-date markers (including the primary-completion-date glyph) that live
 * in the space's dashboard/landscape reads. triggerSingleTrialSync must, when
 * given a spaceId, invalidate those space tags on success -- otherwise a
 * timeline fetched between the import commit and the sync's completion keeps
 * serving the pre-sync snapshot (bars, no PCD) until a hard refresh. See #175/#177.
 */

function makeService(syncResult: { ok: boolean; nct_id?: string; reason?: string }): {
  service: ChangeEventService;
  cache: RpcCache;
} {
  const cache = new RpcCache();
  const client = {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'token' } } }),
    },
  };
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: { client } as unknown as SupabaseService },
      { provide: RpcCache, useValue: cache },
    ],
  });
  // The plain-node units runner has no `window`; the service reads
  // window.__WORKER_API_BASE to build the worker URL.
  vi.stubGlobal('window', {});
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(syncResult),
    })
  );
  return runInInjectionContext(injector, () => ({
    service: new ChangeEventService(),
    cache,
  }));
}

describe('ChangeEventService.triggerSingleTrialSync cache invalidation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates the dashboard + landscape tags (plus trial tags) when a spaceId is passed', async () => {
    const { service, cache } = makeService({ ok: true, nct_id: 'NCT01' });
    await service.triggerSingleTrialSync('trial-1', 'space-1');
    expect(cache.invalidations().tags).toEqual([
      'trial:trial-1:detail',
      'trial:trial-1:activity',
      'space:space-1:dashboard',
      'space:space-1:landscape-all',
    ]);
  });

  it('invalidates only the trial tags when no spaceId is passed', async () => {
    const { service, cache } = makeService({ ok: true, nct_id: 'NCT01' });
    await service.triggerSingleTrialSync('trial-1');
    expect(cache.invalidations().tags).toEqual([
      'trial:trial-1:detail',
      'trial:trial-1:activity',
    ]);
  });

  it('does not invalidate anything when the sync reports not-ok', async () => {
    const { service, cache } = makeService({ ok: false, reason: 'no_nct_id' });
    await service.triggerSingleTrialSync('trial-1', 'space-1');
    // seq stays 0 -> no invalidation was emitted.
    expect(cache.invalidations().seq).toBe(0);
  });
});

describe('ChangeEventService (setup)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('is constructable in an injection context', () => {
    const { service } = makeService({ ok: true });
    expect(service).toBeInstanceOf(ChangeEventService);
    vi.unstubAllGlobals();
  });
});
