import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drainR2DeleteQueue,
  type DrainSummary,
  type PendingDeleteRow,
  type R2DeleteClient,
  type R2DrainEnv,
} from '../../r2-drain/queue';

const SUPABASE_URL = 'https://stub.supabase.co';
const TABLE_URL = `${SUPABASE_URL}/rest/v1/r2_pending_deletes`;

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeEnv(over: Partial<R2DrainEnv> = {}): R2DrainEnv {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    R2_BUCKET: 'clint-materials',
    ...over,
  };
}

interface FetchTap {
  method: string;
  url: string;
  search: URLSearchParams;
  body: Record<string, unknown> | null;
  headers: Headers;
}

interface QueueFixture {
  rows: PendingDeleteRow[];
  patches: Record<string, Record<string, unknown>>;
}

/**
 * Installs a fetch mock that emulates PostgREST direct-table access
 * against public.r2_pending_deletes. The fixture is treated as the
 * authoritative state of the queue. GET filters by succeeded_at +
 * attempt_count; PATCH updates the fixture in place. Every request is
 * recorded into `taps` so tests can assert on the wire-level shape.
 */
function installQueueFetch(fixture: QueueFixture): { taps: FetchTap[]; r2: MockR2 } {
  const taps: FetchTap[] = [];
  const r2 = new MockR2();

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      const url = new URL(req.url);
      const tap: FetchTap = {
        method: req.method,
        url: req.url,
        search: url.searchParams,
        body: null,
        headers: req.headers,
      };
      if (req.method !== 'GET') {
        const text = await req.clone().text();
        tap.body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      }
      taps.push(tap);

      if (!req.url.startsWith(TABLE_URL)) {
        throw new Error(`unexpected fetch: ${req.url}`);
      }

      // Surface a clear failure if a test ever ships a request without
      // the service-role key: the table grants make the request fail at
      // PostgREST today, so mirror that here.
      const apikey = req.headers.get('apikey');
      if (!apikey) {
        return new Response('missing apikey', { status: 401 });
      }

      if (req.method === 'GET') {
        return handleSelect(url.searchParams, fixture);
      }
      if (req.method === 'PATCH') {
        return handlePatch(url.searchParams, tap.body ?? {}, fixture);
      }
      throw new Error(`unexpected method: ${req.method}`);
    }
  );

  return { taps, r2 };
}

function handleSelect(params: URLSearchParams, fixture: QueueFixture): Response {
  // The drain only ever filters by `succeeded_at=is.null` and
  // `attempt_count=lt.<n>`. Honor both here so the IDEMPOTENCY test can
  // assert that succeeded rows fall off, and the MAX-ATTEMPTS test can
  // assert that exhausted rows fall off.
  const limit = Number.parseInt(params.get('limit') ?? '50', 10);
  const lt = params.get('attempt_count') ?? '';
  const maxAttempts = lt.startsWith('lt.') ? Number.parseInt(lt.slice(3), 10) : Number.POSITIVE_INFINITY;

  const rows = fixture.rows
    .filter((r) => {
      const state = fixture.patches[r.id] ?? {};
      const succeededAt = state['succeeded_at'];
      const attemptCount = (state['attempt_count'] as number | undefined) ?? r.attempt_count;
      return !succeededAt && attemptCount < maxAttempts;
    })
    .slice(0, limit)
    .map((r) => {
      const state = fixture.patches[r.id] ?? {};
      return {
        id: r.id,
        file_path: r.file_path,
        attempt_count: (state['attempt_count'] as number | undefined) ?? r.attempt_count,
      };
    });

  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function handlePatch(
  params: URLSearchParams,
  body: Record<string, unknown>,
  fixture: QueueFixture
): Response {
  const idFilter = params.get('id') ?? '';
  const id = idFilter.startsWith('eq.') ? idFilter.slice(3) : '';
  if (!id) {
    return new Response('missing id filter', { status: 400 });
  }
  fixture.patches[id] = { ...(fixture.patches[id] ?? {}), ...body };
  return new Response(null, { status: 204 });
}

class MockR2 implements R2DeleteClient {
  public readonly deleted: string[] = [];
  // Map of file_path -> error to throw. Absent paths resolve.
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

function makeRow(id: string, filePath: string, attemptCount = 0): PendingDeleteRow {
  return { id, file_path: filePath, attempt_count: attemptCount };
}

function assertSummary(actual: DrainSummary, expected: DrainSummary): void {
  expect(actual).toEqual(expected);
}

describe('drainR2DeleteQueue', () => {
  it('HAPPY PATH: drains every pending row when R2 deletes succeed', async () => {
    const fixture: QueueFixture = {
      rows: [
        makeRow('row-1', 'materials/space-a/mat-1/a.pdf'),
        makeRow('row-2', 'materials/space-a/mat-2/b.pdf'),
        makeRow('row-3', 'materials/space-b/mat-3/c.pdf'),
      ],
      patches: {},
    };
    const { taps, r2 } = installQueueFetch(fixture);

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 3,
      succeeded: 3,
      failed: 0,
      max_attempts_hit: 0,
    });

    // R2 receives one DELETE per file_path.
    expect(r2.deleted.sort()).toEqual([
      'materials/space-a/mat-1/a.pdf',
      'materials/space-a/mat-2/b.pdf',
      'materials/space-b/mat-3/c.pdf',
    ]);

    // Every row stamped with succeeded_at + attempted_at, no last_error.
    for (const id of ['row-1', 'row-2', 'row-3']) {
      expect(fixture.patches[id]['succeeded_at']).toBeTruthy();
      expect(fixture.patches[id]['attempted_at']).toBeTruthy();
      expect(fixture.patches[id]['last_error']).toBeNull();
    }

    // The drain selects with succeeded_at=is.null AND attempt_count=lt.5
    // (default MAX_ATTEMPTS), ordered by queued_at ASC. Pin the filter
    // wire shape so a future refactor that breaks the partial index
    // selectivity surfaces here.
    const selectTap = taps.find((t) => t.method === 'GET');
    expect(selectTap).toBeTruthy();
    expect(selectTap!.search.get('succeeded_at')).toBe('is.null');
    expect(selectTap!.search.get('attempt_count')).toBe('lt.5');
    expect(selectTap!.search.get('order')).toBe('queued_at.asc');
  });

  it('TRANSIENT FAILURE: increments attempt_count, captures last_error, leaves row pending', async () => {
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-1/a.pdf', 0)],
      patches: {},
    };
    const { r2 } = installQueueFetch(fixture);
    r2.failOn('materials/space-a/mat-1/a.pdf', 'r2: transient 503');

    const summary = await drainR2DeleteQueue(makeEnv(), r2);

    assertSummary(summary, {
      drained: 1,
      succeeded: 0,
      failed: 1,
      max_attempts_hit: 0,
    });

    // No succeeded_at on the row.
    expect(fixture.patches['row-1']['succeeded_at']).toBeUndefined();
    // attempt_count bumped to 1.
    expect(fixture.patches['row-1']['attempt_count']).toBe(1);
    // last_error captured verbatim from the thrown Error.
    expect(fixture.patches['row-1']['last_error']).toBe('r2: transient 503');
    // attempted_at stamped.
    expect(fixture.patches['row-1']['attempted_at']).toBeTruthy();
  });

  it('MAX ATTEMPTS HIT: row at attempt_count=4 fails -> 5 -> excluded from next drain', async () => {
    // Row arrives one attempt below the default MAX_ATTEMPTS=5. The
    // delete fails again, attempt_count bumps to 5, the row is no longer
    // eligible for selection on a subsequent drain pass.
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-stuck/a.pdf', 4)],
      patches: {},
    };
    const { r2 } = installQueueFetch(fixture);
    r2.failOn('materials/space-a/mat-stuck/a.pdf', 'r2: permanent failure');

    const first = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(first, {
      drained: 1,
      succeeded: 0,
      failed: 1,
      max_attempts_hit: 1,
    });
    expect(fixture.patches['row-1']['attempt_count']).toBe(5);
    expect(fixture.patches['row-1']['last_error']).toBe('r2: permanent failure');
    expect(fixture.patches['row-1']['succeeded_at']).toBeUndefined();

    // Subsequent drain: the row's attempt_count (5) is no longer less
    // than MAX_ATTEMPTS (5), so the fetchPending WHERE clause excludes
    // it. The drain should report zero work.
    const second = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(second, {
      drained: 0,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
    });
  });

  it('IDEMPOTENCY: succeeded rows from a prior drain do not re-drain', async () => {
    const fixture: QueueFixture = {
      rows: [
        makeRow('row-1', 'materials/space-a/mat-1/a.pdf'),
        makeRow('row-2', 'materials/space-a/mat-2/b.pdf'),
      ],
      patches: {},
    };
    const { r2 } = installQueueFetch(fixture);

    const first = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(first, {
      drained: 2,
      succeeded: 2,
      failed: 0,
      max_attempts_hit: 0,
    });
    expect(r2.deleted).toHaveLength(2);

    // Both rows now carry succeeded_at; the next drain selects nothing.
    const second = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(second, {
      drained: 0,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
    });
    // No additional R2 deletes were issued.
    expect(r2.deleted).toHaveLength(2);
  });

  it('EMPTY QUEUE: nothing pending -> summary of zeros, no R2 calls', async () => {
    const fixture: QueueFixture = { rows: [], patches: {} };
    const { taps, r2 } = installQueueFetch(fixture);

    const summary = await drainR2DeleteQueue(makeEnv(), r2);
    assertSummary(summary, {
      drained: 0,
      succeeded: 0,
      failed: 0,
      max_attempts_hit: 0,
    });
    // No PATCHes issued. The lone tap is the SELECT.
    expect(taps.filter((t) => t.method === 'PATCH')).toHaveLength(0);
    expect(r2.deleted).toHaveLength(0);
  });

  it('honors MAX_ATTEMPTS override from env', async () => {
    // With MAX_ATTEMPTS=2, a row at attempt_count=1 that fails bumps to
    // 2 and is excluded next time. This locks in that the env override
    // wires through to both the SELECT filter and the max_attempts_hit
    // accounting.
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-x/x.pdf', 1)],
      patches: {},
    };
    const { r2 } = installQueueFetch(fixture);
    r2.failOn('materials/space-a/mat-x/x.pdf', 'r2: still failing');

    const summary = await drainR2DeleteQueue(makeEnv({ MAX_ATTEMPTS: 2 }), r2);
    assertSummary(summary, {
      drained: 1,
      succeeded: 0,
      failed: 1,
      max_attempts_hit: 1,
    });
    expect(fixture.patches['row-1']['attempt_count']).toBe(2);
  });

  it('forwards the service-role key on both SELECT and PATCH', async () => {
    // The queue table grants writes only to service_role. Pin that the
    // drain attaches the service-role apikey (and bearer) on every
    // request, not just on the read. A regression here would surface as
    // PostgREST 401s on PATCH and the row would never clear.
    const fixture: QueueFixture = {
      rows: [makeRow('row-1', 'materials/space-a/mat-1/a.pdf')],
      patches: {},
    };
    const { taps, r2 } = installQueueFetch(fixture);

    await drainR2DeleteQueue(makeEnv(), r2);

    const select = taps.find((t) => t.method === 'GET');
    const patch = taps.find((t) => t.method === 'PATCH');
    expect(select?.headers.get('apikey')).toBe('service-role-key');
    expect(select?.headers.get('Authorization')).toBe('Bearer service-role-key');
    expect(patch?.headers.get('apikey')).toBe('service-role-key');
    expect(patch?.headers.get('Authorization')).toBe('Bearer service-role-key');
  });
});
