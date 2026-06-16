/**
 * Unit tests for SpaceRoleService.ensureRole, the awaitable role resolver
 * added for route guards. Guards run before NavigationEnd, so the previous
 * synchronous canEdit() read raced the role fetch and bounced legitimate
 * space owners off /import (UI review 2026-06-12, item 3).
 *
 * Same harness as the other service specs: plain node environment, no
 * TestBed; a small Injector provides stubbed Router and SupabaseService.
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The units runner is a plain node environment; importing the real
// @angular/router pulls PlatformLocation, which requires the JIT compiler.
// The service only needs the Router token, the NavigationEnd class for its
// instanceof filter, and Event types, so a minimal module stub suffices.
vi.mock('@angular/router', () => {
  class Router {}
  class NavigationEnd {
    constructor(
      public id: number,
      public url: string,
      public urlAfterRedirects: string
    ) {}
  }
  return { Router, NavigationEnd };
});

import { NavigationEnd, Router } from '@angular/router';

import { SpaceRoleService } from './space-role.service';
import { SupabaseService } from './supabase.service';

const SPACE_ID = '11111111-2222-3333-4444-555555555555';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeHarness(result: { data: unknown; error: unknown }, isAgencyMember = false) {
  const events = new Subject<NavigationEnd>();
  const routerStub = { events, url: '/' } as unknown as Router;

  const gate = deferred<{ data: unknown; error: unknown }>();
  const maybeSingle = vi.fn(() => gate.promise);
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  // is_agency_member_of_space is fetched in parallel with the role.
  const rpc = vi.fn(() => Promise.resolve({ data: isAgencyMember, error: null }));
  const supabaseStub = {
    currentUser: () => ({ id: 'user-1' }),
    client: { from, rpc },
  } as unknown as SupabaseService;

  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: routerStub },
      { provide: SupabaseService, useValue: supabaseStub },
    ],
  });
  const service = runInInjectionContext(injector, () => new SpaceRoleService());
  return {
    service,
    events,
    from,
    resolveFetch: () => gate.resolve(result),
  };
}

describe('SpaceRoleService.ensureRole', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns the role on a direct guard call (no NavigationEnd yet)', async () => {
    const h = makeHarness({ data: { role: 'owner' }, error: null });
    const pending = h.service.ensureRole(SPACE_ID);
    h.resolveFetch();
    await expect(pending).resolves.toBe('owner');
    expect(h.service.canEdit()).toBe(true);
  });

  it('awaits an in-flight fetch started by navigation instead of misreading null', async () => {
    const h = makeHarness({ data: { role: 'editor' }, error: null });
    h.events.next(new NavigationEnd(1, `/t/x/s/${SPACE_ID}/import`, `/t/x/s/${SPACE_ID}/import`));
    // Guard runs while the fetch is still in flight.
    const pending = h.service.ensureRole(SPACE_ID);
    h.resolveFetch();
    await expect(pending).resolves.toBe('editor');
    expect(h.from).toHaveBeenCalledTimes(1);
  });

  it('returns the cached role without refetching the same space', async () => {
    const h = makeHarness({ data: { role: 'viewer' }, error: null });
    const first = h.service.ensureRole(SPACE_ID);
    h.resolveFetch();
    await first;
    await expect(h.service.ensureRole(SPACE_ID)).resolves.toBe('viewer');
    expect(h.from).toHaveBeenCalledTimes(1);
  });

  it('resolves null when the user has no space_members row', async () => {
    const h = makeHarness({ data: null, error: null });
    const pending = h.service.ensureRole(SPACE_ID);
    h.resolveFetch();
    await expect(pending).resolves.toBeNull();
    expect(h.service.canEdit()).toBe(false);
  });

  it('tracks agency membership separately from the space role (P1.3b)', async () => {
    // A space editor who is NOT an agency member: canEdit true, but
    // isAgencyMember false (cannot author intelligence).
    const editor = makeHarness({ data: { role: 'editor' }, error: null }, false);
    editor.resolveFetch();
    await editor.service.ensureRole(SPACE_ID);
    expect(editor.service.canEdit()).toBe(true);
    expect(editor.service.isAgencyMember()).toBe(false);

    // An agency member resolves isAgencyMember true.
    const agency = makeHarness({ data: { role: 'editor' }, error: null }, true);
    agency.resolveFetch();
    await agency.service.ensureRole(SPACE_ID);
    expect(agency.service.isAgencyMember()).toBe(true);
  });
});
