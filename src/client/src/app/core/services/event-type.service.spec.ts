import { Injector, runInInjectionContext } from '@angular/core';

import { EventTypeService } from './event-type.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

interface QueryStub {
  select: () => QueryStub;
  order: () => QueryStub;
  or: () => QueryStub;
  throwOnError: () => Promise<{ data: unknown[] }>;
}

function makeService(
  from: (table: string) => unknown,
  cacheGet: (k: string, p: unknown, o: { fetch: () => Promise<unknown> }) => Promise<unknown>
): EventTypeService {
  const supabase = { client: { from } } as unknown as SupabaseService;
  const cache = { get: cacheGet } as unknown as RpcCache;
  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabase },
      { provide: RpcCache, useValue: cache },
    ],
  });
  return runInInjectionContext(injector, () => new EventTypeService());
}

describe('EventTypeService', () => {
  it('lists system + space event types ordered by display_order', async () => {
    const rows = [{ id: 'a', name: 'Topline Data', display_order: 1, is_system: true }];
    const orSpy = { called: false };
    const query: QueryStub = {
      select: () => query,
      order: () => query,
      or: () => { orSpy.called = true; return query; },
      throwOnError: async () => ({ data: rows }),
    };
    const svc = makeService(
      () => query,
      (_k, _p, o) => o.fetch()
    );

    const out = await svc.list('space-1');

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Topline Data');
    expect(orSpy.called).toBe(true);
  });

  it('omits the or() filter when no spaceId is provided', async () => {
    const rows: unknown[] = [];
    const orSpy = { called: false };
    const query: QueryStub = {
      select: () => query,
      order: () => query,
      or: () => { orSpy.called = true; return query; },
      throwOnError: async () => ({ data: rows }),
    };
    const svc = makeService(
      () => query,
      (_k, _p, o) => o.fetch()
    );

    await svc.list();

    expect(orSpy.called).toBe(false);
  });
});
