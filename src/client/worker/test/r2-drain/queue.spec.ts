import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drainR2DeleteQueue,
  type DrainSummary,
  type PendingDeleteRow,
  type R2DeleteClient,
  type R2DrainEnv,
} from '../../r2-drain/queue';

const SUPABASE_URL = 'https://stub.supabase.co';
const RPC_BASE = `${SUPABASE_URL}/rest/v1/rpc`;
const RPC_CLAIM = `${RPC_BASE}/claim_pending_r2_deletes`;
const RPC_SUCCEEDED = `${RPC_BASE}/mark_r2_delete_succeeded`;
const RPC_FAILED = `${RPC_BASE}/mark_r2_delete_failed`;
const RPC_DEFERRED = `${RPC_BASE}/mark_r2_delete_deferred`;
const RPC_GATE = `${RPC_BASE}/r2_drain_gate`;
const ANON_KEY = 'anon-key';
const WORKER_SECRET = 'r2-worker-secret';

// A bucket lock rejection from R2 (error code 10069). The drain must
// reschedule (defer) these instead of burning an attempt as a failure.
const BUCKET_LOCK_MESSAGE =
  'delete: Object is protected by a bucket lock rule and cannot be modified or deleted. (10069)';

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeEnv(over: Partial<R2DrainEnv> = {}): R2DrainEnv {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    R2_WORKER_SECRET: WORKER_SECRET,
    ...over,
  };
}

interface FetchTap {
  rpc: 'gate' | 'claim' | 'succeeded' | 'failed' | 'deferred' | 'other';
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

interface GateRow {
  allowed: boolean;
  unattempted_count: number;
  effective_cap: number;
  reason: string;
}

// Default gate response: allow the drain, mirroring the live RPC's
// single-row TABLE-returning shape (PostgREST wraps it in an array).
function allowGate(over: Partial<GateRow> = {}): GateRow[] {
  return [
    {
      allowed: true,
      unattempted_count: 0,
      effective_cap: 1000,
      reason: 'within cap',
      ...over,
    },
  ];
}

interface QueueRow {
  id: string;
  file_path: string;
  attempt_count: number;
  succeeded_at: string | null;
  last_error: string | null;
}

interface QueueFixture {
  rows: QueueRow[];
}

/**
 * Mocks the three drain RPCs against an in-memory fixture. The fixture
 * is treated as the authoritative state of the queue. Each RPC mutates
 * the fixture and returns the same shape PostgREST would return. Every
 * request is recorded into `taps` so tests can pin the wire shape.
 */
function installRpcMock(
  fixture: QueueFixture,
  gate: GateRow[] = allowGate()
): { taps: FetchTap[]; r2: MockR2 } {
  const taps: FetchTap[] = [];
  const r2 = new MockR2();

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      const url = req.url;
      const bodyText = await req.clone().text();
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

      const rpc: FetchTap['rpc'] =
        url === RPC_GATE
          ? 'gate'
          : url === RPC_CLAIM
            ? 'claim'
            : url === RPC_SUCCEEDED
              ? 'succeeded'
              : url === RPC_FAILED
                ? 'failed'
                : url === RPC_DEFERRED
                  ? 'deferred'
                  : 'other';
      taps.push({ rpc, url, body, headers: req.headers });

      if (rpc === 'other') {
        throw new Error(`unexpected fetch: ${url}`);
      }

      // Every drain RPC requires the worker secret as its first arg.
      // Surface a clear failure if a test ever ships a request without
      // it (which would 42501 against the real RPC).
      if (body['p_secret'] !== WORKER_SECRET) {
        return new Response(JSON.stringify({ code: '42501', message: 'unauthorized' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (rpc === 'gate') {
        return new Response(JSON.stringify(gate), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (rpc === 'claim') return handleClaim(body, fixture);
      if (rpc === 'succeeded') return handleMarkSucceeded(body, fixture);
      if (rpc === 'deferred') return handleMarkDeferred(body, fixture);
      return handleMarkFailed(body, fixture);
    }
  );

  return { taps, r2 };
}

function handleClaim(body: Record<string, unknown>, fixture: QueueFixture): Response {
  const limit = (body['p_batch_size'] as number | undefined) ?? 50;
  const maxAttempts = (body['p_max_attempts'] as number | undefined) ?? Number.POSITIVE_INFINITY;

  const claimed = fixture.rows
    .filter((r) => r.succeeded_at === null && r.attempt_count < maxAttempts)
    .slice(0, limit)
    .map((r) => ({ id: r.id, file_path: r.file_path, attempt_count: r.attempt_count }));

  return new Response(JSON.stringify(claimed), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function handleMarkSucceeded(body: Record<string, unknown>, fixture: QueueFixture): Response {
  const id = body['p_id'] as string;
  const row = fixture.rows.find((r) => r.id === id);
  if (row) {
    row.succeeded_at = new Date().toISOString();
  }
  return new Response('', { status: 200 });
}

function handleMarkFailed(body: Record<string, unknown>, fixture: QueueFixture): Response {
  const id = body['p_id'] as string;
  const row = fixture.rows.find((r) => r.id === id);
  if (row) {
    row.attempt_count = body['p_attempt_count'] as number;
    row.last_error = body['p_error'] as string;
  }
  return new Response('', { status: 200 });
}

// mark_r2_delete_deferred reschedules a row without burning an attempt:
// it records the reason but does NOT touch attempt_count (the RPC bumps
// next_attempt_at server-side). Mirror that here -- only last_error moves.
function handleMarkDeferred(body: Record<string, unknown>, fixture: QueueFixture): Response {
  const id = body['p_id'] as string;
  const row = fixture.rows.find((r) => r.id === id);
  if (row) {
    row.last_error = body['p_reason'] as string;
  }
  return new Response('', { status: 200 });
}

class MockR2 implements R2DeleteClient {
  public readonly deleted: string[] = [];
  private readonly failures = new Map<string, string>();

  failOn(path: string, message: string): void {
    this.failures.set(path, message);
  }

  async delete(key: string): Promise<void> {
    const failureMessage = this.failures.get(key);
    if (failureMessage) {
      throw new Error(failureMessage);
    }
    this.deleted.push(key);
  }
}

function makeRow(id: string, filePath: string, attemptCount = 0): QueueRow {
  return {
    id,
    file_path: filePath,
    attempt_count: attemptCount,
    succeeded_at: null,
    last_error: null,
  };
}

function assertSummary(actual: DrainSummary, expected: DrainSummary): void {
  expect(actual).toEqual(expected);
}

describe('drainR2DeleteQueue (worker-secret + RPC pattern)', () => {
  it('HAPPY PATH: drains every pending row when R2 deletes succeed', async () => {
    const fixture: QueueFixture = {
      rows: [
        makeRow('row-1', 'materials/space-a/mat-1/a.pdf'),
        makeRow('row-2', 'materials/space-a/mat-2/b.pdf'),
        makeRow('row-3', 'materials/space-b/mat-3/c.pdf'),
      ],
    };
    const { taps, r2 } = installRpcMock(fixture);

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 3,
      succeeded: 3,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });

    expect(r2.deleted.sort()).toEqual([
      'materials/space-a/mat-1/a.pdf',
      'materials/space-a/mat-2/b.pdf',
      'materials/space-b/mat-3/c.pdf',
    ]);

    // One claim, three mark_succeeded, zero mark_failed.
    expect(taps.filter((t) => t.rpc === 'claim')).toHaveLength(1);
    expect(taps.filter((t) => t.rpc === 'succeeded')).toHaveLength(3);
    expect(taps.filter((t) => t.rpc === 'failed')).toHaveLength(0);

    // All three rows carry succeeded_at on the fixture.
    for (const id of ['row-1', 'row-2', 'row-3']) {
      const row = fixture.rows.find((r) => r.id === id)!;
      expect(row.succeeded_at).not.toBeNull();
    }
  });

  it('CLAIM ARGS: passes batch_size + max_attempts as RPC args', async () => {
    const fixture: QueueFixture = { rows: [] };
    const { taps } = installRpcMock(fixture);

    await drainR2DeleteQueue(makeEnv(), new MockR2());

    const claim = taps.find((t) => t.rpc === 'claim')!;
    expect(claim.body['p_secret']).toBe(WORKER_SECRET);
    expect(claim.body['p_batch_size']).toBe(50);
    expect(claim.body['p_max_attempts']).toBe(5);
  });

  it('TRANSIENT FAILURE: increments attempt_count, captures last_error, leaves row pending', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-1/a.pdf', 0)],
    };
    const { taps, r2 } = installRpcMock(fixture);
    r2.failOn('materials/space-a/mat-1/a.pdf', 'r2: transient 503');

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 1,
      succeeded: 0,
      failed: 1,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });

    const row = fixture.rows[0];
    expect(row.succeeded_at).toBeNull();
    expect(row.attempt_count).toBe(1);
    expect(row.last_error).toBe('r2: transient 503');

    const failedCall = taps.find((t) => t.rpc === 'failed')!;
    expect(failedCall.body['p_attempt_count']).toBe(1);
    expect(failedCall.body['p_error']).toBe('r2: transient 503');
  });

  it('MAX ATTEMPTS HIT: row at attempt_count=4 fails -> 5 -> excluded from next drain', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-stuck/a.pdf', 4)],
    };
    const { r2 } = installRpcMock(fixture);
    r2.failOn('materials/space-a/mat-stuck/a.pdf', 'r2: permanent failure');

    const first = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(first, {
      drained: 1,
      succeeded: 0,
      failed: 1,
      max_attempts_hit: 1,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });
    expect(fixture.rows[0].attempt_count).toBe(5);
    expect(fixture.rows[0].last_error).toBe('r2: permanent failure');
    expect(fixture.rows[0].succeeded_at).toBeNull();

    // Subsequent drain: claim filters by attempt_count < max_attempts (5),
    // so this row is no longer returned.
    const second = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(second, {
      drained: 0,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });
  });

  it('IDEMPOTENCY: succeeded rows from a prior drain do not re-drain', async () => {
    const fixture: QueueFixture = {
      rows: [
        makeRow('row-1', 'materials/space-a/mat-1/a.pdf'),
        makeRow('row-2', 'materials/space-a/mat-2/b.pdf'),
      ],
    };
    const { r2 } = installRpcMock(fixture);

    const first = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(first, {
      drained: 2,
      succeeded: 2,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });
    expect(r2.deleted).toHaveLength(2);

    // claim filters succeeded rows out; second drain returns empty.
    const second = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(second, {
      drained: 0,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });
    expect(r2.deleted).toHaveLength(2);
  });

  it('EMPTY QUEUE: nothing pending -> summary of zeros, no R2 calls', async () => {
    const fixture: QueueFixture = { rows: [] };
    const { taps, r2 } = installRpcMock(fixture);

    const summary = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(summary, {
      drained: 0,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });
    // No mark_* calls; the lone request is the empty claim.
    expect(taps.filter((t) => t.rpc === 'succeeded')).toHaveLength(0);
    expect(taps.filter((t) => t.rpc === 'failed')).toHaveLength(0);
    expect(r2.deleted).toHaveLength(0);
  });

  it('honors MAX_ATTEMPTS + BATCH_SIZE override from env', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-x/x.pdf', 1)],
    };
    const { taps, r2 } = installRpcMock(fixture);
    r2.failOn('materials/space-a/mat-x/x.pdf', 'r2: still failing');

    const summary = await drainR2DeleteQueue(makeEnv({ MAX_ATTEMPTS: 2, BATCH_SIZE: 10 }), r2);
    assertSummary(summary, {
      drained: 1,
      succeeded: 0,
      failed: 1,
      max_attempts_hit: 1,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });
    expect(fixture.rows[0].attempt_count).toBe(2);

    // The override flows through to the RPC args (not just to the
    // accounting), so the DB-side query also respects the cap.
    const claim = taps.find((t) => t.rpc === 'claim')!;
    expect(claim.body['p_max_attempts']).toBe(2);
    expect(claim.body['p_batch_size']).toBe(10);
  });

  it('forwards the anon key (not service_role) on every RPC', async () => {
    // The new design uses the anon key as the PostgREST apikey + the
    // worker secret as the function arg. service_role must not appear.
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-1/a.pdf')],
    };
    const { taps, r2 } = installRpcMock(fixture);

    await drainR2DeleteQueue(makeEnv(), r2);

    for (const tap of taps) {
      expect(tap.headers.get('apikey')).toBe(ANON_KEY);
      // The Authorization header is only attached when the worker
      // forwards a user JWT. The drain calls callRpc with authHeader=null,
      // so Authorization should be absent.
      expect(tap.headers.get('Authorization')).toBeNull();
      expect(tap.body['p_secret']).toBe(WORKER_SECRET);
    }
  });

  it('propagates unauthorized (42501) when the worker secret is wrong', async () => {
    const fixture: QueueFixture = { rows: [] };
    installRpcMock(fixture);

    await expect(
      drainR2DeleteQueue(makeEnv({ R2_WORKER_SECRET: 'wrong' }), new MockR2())
    ).rejects.toThrow(/r2_drain_gate failed/);
  });

  it('BUCKET LOCK DEFER: a 10069 rejection reschedules via mark_r2_delete_deferred, not failed', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-locked/a.pdf', 0)],
    };
    const { taps, r2 } = installRpcMock(fixture);
    r2.failOn('materials/space-a/mat-locked/a.pdf', BUCKET_LOCK_MESSAGE);

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 1,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 1,
      paused: false,
      unattempted: 0,
    });

    // Routed to the defer RPC, never the failure RPC.
    expect(taps.filter((t) => t.rpc === 'deferred')).toHaveLength(1);
    expect(taps.filter((t) => t.rpc === 'failed')).toHaveLength(0);

    const deferCall = taps.find((t) => t.rpc === 'deferred')!;
    expect(deferCall.body['p_id']).toBe('row-1');
    expect(deferCall.body['p_reason']).toBe(BUCKET_LOCK_MESSAGE);

    // A deferral does NOT burn an attempt; the RPC handles next_attempt_at.
    expect(fixture.rows[0].attempt_count).toBe(0);
    expect(fixture.rows[0].succeeded_at).toBeNull();
  });

  it('NON-LOCK FAILURE: a non-lock error still routes to mark_r2_delete_failed', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-net/a.pdf', 0)],
    };
    const { taps, r2 } = installRpcMock(fixture);
    r2.failOn('materials/space-a/mat-net/a.pdf', 'network');

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 1,
      succeeded: 0,
      failed: 1,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 0,
    });

    expect(taps.filter((t) => t.rpc === 'failed')).toHaveLength(1);
    expect(taps.filter((t) => t.rpc === 'deferred')).toHaveLength(0);
    expect(fixture.rows[0].attempt_count).toBe(1);
    expect(fixture.rows[0].last_error).toBe('network');
  });

  it('GATE DENY: a denied volume gate short-circuits before claiming -- deletes nothing', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-1/a.pdf')],
    };
    const { taps, r2 } = installRpcMock(fixture, [
      {
        allowed: false,
        unattempted_count: 5000,
        effective_cap: 1000,
        reason: 'unattempted backlog exceeds cap',
      },
    ]);

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 0,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 0,
      paused: true,
      unattempted: 5000,
    });

    // Gate denial means: no claim, no R2 delete, no mark_* of any kind.
    expect(taps.filter((t) => t.rpc === 'gate')).toHaveLength(1);
    expect(taps.filter((t) => t.rpc === 'claim')).toHaveLength(0);
    expect(taps.filter((t) => t.rpc === 'succeeded')).toHaveLength(0);
    expect(taps.filter((t) => t.rpc === 'failed')).toHaveLength(0);
    expect(taps.filter((t) => t.rpc === 'deferred')).toHaveLength(0);
    expect(r2.deleted).toHaveLength(0);
  });

  it('GATE ALLOW: an allowed gate drains normally and reports paused=false', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-1/a.pdf')],
    };
    const { taps, r2 } = installRpcMock(fixture, allowGate({ unattempted_count: 2 }));

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 1,
      succeeded: 1,
      failed: 0,
      max_attempts_hit: 0,
      deferred: 0,
      paused: false,
      unattempted: 2,
    });

    expect(taps.filter((t) => t.rpc === 'gate')).toHaveLength(1);
    expect(taps.filter((t) => t.rpc === 'claim')).toHaveLength(1);
    expect(r2.deleted).toEqual(['materials/space-a/mat-1/a.pdf']);
  });
});
