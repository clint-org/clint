/**
 * Unit tests for ReviewPageComponent duplicate-source handling.
 *
 * commit_source_import returns a SUCCESS payload { code: 'duplicate_source', existing_id }
 * (no Postgres error) when the same source text was already imported. The component must
 * detect this code, surface a warning instead of a success toast, and offer a
 * "Commit anyway" action that re-sends with allow_duplicate: true.
 *
 * review-page.component.ts imports NgTemplateOutlet from @angular/common, whose static
 * initializer expects the Angular compiler facade. Load it first (per Angular's error
 * guidance) before importing the component. Mirrors export-button.component.spec.ts.
 *
 * The vitest.units.config.ts runner uses a plain node environment (no DOM). We construct
 * the component inside a minimal Injector via runInInjectionContext so inject() calls
 * resolve against stub providers instead of the real services.
 */
// Must be the first import so the JIT facade is present when @angular/common loads.
import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ReviewPageComponent } from './review-page.component';
import { SupabaseService } from '../../core/services/supabase.service';
import { SourceImportService, type SourceImportProposal } from './source-import.service';
import { MessageService } from 'primeng/api';
import { RpcCache } from '../../core/services/rpc-cache.service';
import { ChangeEventService } from '../../core/services/change-event.service';
import { MarkerTypeService } from '../../core/services/marker-type.service';
import { ActivatedRoute, Router } from '@angular/router';

// Minimal valid proposal -- all arrays empty so buildCommitPayload() runs without
// touching absent data. Non-NCT source so triggerSingleTrialSync is not called.
const MINIMAL_PROPOSAL: SourceImportProposal = {
  ai_call_id: 'call-1',
  source_kind: 'text',
  source_url: null,
  source_text: 'test text',
  source_text_hash: 'abc123',
  source_title: 'Test source',
  source_date: null,
  source_summary: 'Test summary',
  proposals: {
    source_summary: 'Test summary',
    source_title: 'Test source',
    source_date: null,
    companies: [],
    assets: [],
    trials: [],
    markers: [],
    events: [],
  },
  dropped: [],
  fuzzy_alternates: {},
  ctgov_candidates: {},
  inventory_snapshot_hash: 'snap-hash',
  warnings: [],
  resolved_names: {},
  resolved_identifiers: {},
};

// Cast interface used to access protected component members in tests.
interface TestableReviewPage {
  confirm(): Promise<void>;
  commitAllowingDuplicate(): Promise<void>;
  committed: ReturnType<typeof signal<boolean>>;
  duplicateBlocked: ReturnType<typeof signal<boolean>>;
  commitError: ReturnType<typeof signal<string | null>>;
  spaceId: ReturnType<typeof signal<string>>;
  aiCallId: ReturnType<typeof signal<string>>;
}

function makeComponent() {
  const rpcMock = vi.fn();
  const messagesAddSpy = vi.fn();

  const sourceImportSvc = new SourceImportService();
  sourceImportSvc.setProposal(MINIMAL_PROPOSAL);

  const supabaseStub = {
    // Non-null session so confirm() does not short-circuit.
    session: signal<{ user: { id: string } } | null>({ user: { id: 'user-1' } }),
    client: { rpc: rpcMock },
  } as unknown as SupabaseService;

  const messagesStub = { add: messagesAddSpy } as unknown as MessageService;
  const rpcCacheStub = { invalidateTags: vi.fn() } as unknown as RpcCache;
  const changeEventStub = {
    triggerSingleTrialSync: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChangeEventService;
  const markerTypeStub = {
    list: vi.fn().mockResolvedValue([]),
  } as unknown as MarkerTypeService;
  const routeStub = {
    snapshot: {
      paramMap: { has: () => false, get: () => null },
      parent: null,
    },
  } as unknown as ActivatedRoute;
  const routerStub = {
    navigate: vi.fn().mockResolvedValue(true),
  } as unknown as Router;

  const injector = Injector.create({
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      { provide: SourceImportService, useValue: sourceImportSvc },
      { provide: MessageService, useValue: messagesStub },
      { provide: RpcCache, useValue: rpcCacheStub },
      { provide: ChangeEventService, useValue: changeEventStub },
      { provide: MarkerTypeService, useValue: markerTypeStub },
      { provide: ActivatedRoute, useValue: routeStub },
      { provide: Router, useValue: routerStub },
    ],
  });

  const component = runInInjectionContext(
    injector,
    () => new ReviewPageComponent()
  ) as unknown as TestableReviewPage;

  // Set route params directly since ngOnInit is not called.
  component.spaceId.set('space-1');
  component.aiCallId.set('call-1');

  return { component, rpcMock, messagesAddSpy };
}

describe('ReviewPageComponent -- duplicate_source handling', () => {
  let component: TestableReviewPage;
  let rpcMock: ReturnType<typeof vi.fn>;
  let messagesAddSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ component, rpcMock, messagesAddSpy } = makeComponent());
  });

  it('does not report success when commit returns duplicate_source', async () => {
    rpcMock.mockResolvedValue({
      data: { code: 'duplicate_source', existing_id: 'doc-x' },
      error: null,
    });

    await component.confirm();

    expect(component.committed()).toBe(false);
    expect(component.duplicateBlocked()).toBe(true);
    expect(messagesAddSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success' })
    );
  });

  it('sets commitError with an actionable warning on duplicate_source', async () => {
    rpcMock.mockResolvedValue({
      data: { code: 'duplicate_source', existing_id: 'doc-x' },
      error: null,
    });

    await component.confirm();

    expect(component.commitError()).not.toBeNull();
    expect(component.commitError()).toContain('already imported');
  });

  it('commitAllowingDuplicate sends allow_duplicate in p_source_document', async () => {
    rpcMock.mockResolvedValue({ data: { created: {} }, error: null });

    await component.commitAllowingDuplicate();

    const callArgs = rpcMock.mock.calls.at(-1);
    expect(callArgs).toBeDefined();
    const arg = callArgs![1] as { p_source_document: Record<string, unknown> };
    expect(arg.p_source_document['allow_duplicate']).toBe(true);
  });

  it('clears duplicateBlocked after commitAllowingDuplicate succeeds', async () => {
    // Put the component into the blocked state first.
    rpcMock.mockResolvedValueOnce({
      data: { code: 'duplicate_source', existing_id: 'doc-x' },
      error: null,
    });
    await component.confirm();
    expect(component.duplicateBlocked()).toBe(true);

    // Now commit anyway.
    rpcMock.mockResolvedValueOnce({ data: { created: {} }, error: null });
    await component.commitAllowingDuplicate();
    expect(component.duplicateBlocked()).toBe(false);
  });
});
