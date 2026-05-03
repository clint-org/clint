import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScheduledSync, runManualBackfill } from '../../ctgov-sync/poller';
import type { CtgovSyncEnv } from '../../ctgov-sync/types';

const SUPABASE_URL = 'https://stub.supabase.co';
const CTGOV_BASE_URL = 'https://ctgov.test';

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeEnv(over: Partial<CtgovSyncEnv> = {}): CtgovSyncEnv {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon',
    CTGOV_BASE_URL,
    CTGOV_BATCH_SIZE: '100',
    CTGOV_PARALLEL_FETCHES: '10',
    CTGOV_WORKER_SECRET: 'test-secret',
    ...over,
  };
}

type FetchHandler = (req: Request) => Response | Promise<Response> | null;

interface RpcCall {
  fn: string;
  body: Record<string, unknown>;
}

interface MockHarness {
  rpcCalls: RpcCall[];
  ctgovCalls: string[];
}

function installFetch(handlers: FetchHandler[]): MockHarness {
  const harness: MockHarness = { rpcCalls: [], ctgovCalls: [] };

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      // Tap RPC and CT.gov calls so tests can assert on them.
      if (req.url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)) {
        const fn = req.url.substring(`${SUPABASE_URL}/rest/v1/rpc/`.length);
        const text = await req.clone().text();
        const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
        harness.rpcCalls.push({ fn, body });
      } else if (req.url.startsWith(CTGOV_BASE_URL)) {
        harness.ctgovCalls.push(req.url);
      }
      for (const h of handlers) {
        const out = await h(req);
        if (out !== null) return out;
      }
      throw new Error(`unexpected fetch: ${req.url}`);
    }
  );

  return harness;
}

function rpcHandler(
  map: Record<string, (body: Record<string, unknown>) => Response>
): FetchHandler {
  return (req) => {
    if (!req.url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)) return null;
    const fn = req.url.substring(`${SUPABASE_URL}/rest/v1/rpc/`.length);
    const handler = map[fn];
    if (!handler) {
      throw new Error(`no rpc mock for ${fn}`);
    }
    // The body has already been read once by installFetch; we re-parse here
    // because the cloned request was consumed in the harness layer. The
    // RpcCall body recorded there is the source of truth for assertions.
    return handler({});
  };
}

function ctgovSummaryHandler(responder: (nctIds: string[]) => Response): FetchHandler {
  return (req) => {
    if (!req.url.startsWith(`${CTGOV_BASE_URL}/api/v2/studies?`)) return null;
    const url = new URL(req.url);
    const term = url.searchParams.get('query.term') ?? '';
    // term shape: (NCT01 OR NCT02). Strip parens, split on " OR ".
    const stripped = term.replace(/^\(/, '').replace(/\)$/, '');
    const nctIds = stripped ? stripped.split(' OR ') : [];
    return responder(nctIds);
  };
}

function ctgovStudyHandler(responder: (nctId: string) => Response): FetchHandler {
  return (req) => {
    const m = req.url.match(/^https:\/\/ctgov\.test\/api\/v2\/studies\/(NCT[^/?]+)$/);
    if (!m) return null;
    return responder(m[1]);
  };
}

function ctgovHistoryHandler(): FetchHandler {
  // Always 404 history; opportunistic, never used in assertions.
  return (req) => {
    if (!req.url.match(/^https:\/\/ctgov\.test\/api\/int\/studies\/[^/]+\/history$/)) return null;
    return new Response('', { status: 404 });
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function summaryStudy(nctId: string, postDate: string) {
  return {
    protocolSection: {
      identificationModule: { nctId },
      statusModule: { lastUpdatePostDateStruct: { date: postDate } },
    },
  };
}

describe('runScheduledSync', () => {
  it('happy path with no changes: skips ingest, marks all polled, status=success', async () => {
    const trials = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-04-01',
        latest_ctgov_version: null,
      },
      {
        trial_id: 't2',
        space_id: 's1',
        nct_id: 'NCT02',
        last_update_posted_date: '2026-03-15',
        latest_ctgov_version: null,
      },
      {
        trial_id: 't3',
        space_id: 's2',
        nct_id: 'NCT03',
        last_update_posted_date: '2026-02-20',
        latest_ctgov_version: null,
      },
    ];

    const harness = installFetch([
      rpcHandler({
        get_trials_for_polling: () => jsonResponse(trials),
        bulk_update_last_polled: () => jsonResponse(3),
        record_sync_run: () => jsonResponse('00000000-0000-0000-0000-000000000001'),
      }),
      ctgovSummaryHandler(() =>
        jsonResponse({
          studies: [
            summaryStudy('NCT01', '2026-04-01'),
            summaryStudy('NCT02', '2026-03-15'),
            summaryStudy('NCT03', '2026-02-20'),
          ],
        })
      ),
      ctgovHistoryHandler(),
    ]);

    const summary = await runScheduledSync(makeEnv());

    expect(summary.status).toBe('success');
    expect(summary.snapshots_written).toBe(0);
    expect(summary.events_emitted).toBe(0);
    expect(summary.trials_checked).toBe(3);
    expect(summary.ncts_with_changes).toBe(0);
    expect(summary.errors_count).toBe(0);

    // No ingest calls.
    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(0);

    // bulk_update_last_polled called once with all 3 trial_ids and the secret.
    const bulkCalls = harness.rpcCalls.filter((c) => c.fn === 'bulk_update_last_polled');
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0].body['p_secret']).toBe('test-secret');
    const polledIds = bulkCalls[0].body['p_trial_ids'] as string[];
    expect(polledIds.sort()).toEqual(['t1', 't2', 't3']);

    // record_sync_run called once with status=success.
    const recordCalls = harness.rpcCalls.filter((c) => c.fn === 'record_sync_run');
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].body['p_secret']).toBe('test-secret');
    expect(recordCalls[0].body['p_status']).toBe('success');
    expect(recordCalls[0].body['p_snapshots_written']).toBe(0);
    expect(recordCalls[0].body['p_events_emitted']).toBe(0);
    expect(recordCalls[0].body['p_errors_count']).toBe(0);

    // get_trials_for_polling called once with computed limit (100 * 10 = 1000).
    const queueCalls = harness.rpcCalls.filter((c) => c.fn === 'get_trials_for_polling');
    expect(queueCalls).toHaveLength(1);
    expect(queueCalls[0].body['p_secret']).toBe('test-secret');
    expect(queueCalls[0].body['p_limit']).toBe(1000);
  });

  it('happy path with one change: ingests once, status=success', async () => {
    const trials = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-03-01',
        latest_ctgov_version: null,
      },
    ];

    const harness = installFetch([
      rpcHandler({
        get_trials_for_polling: () => jsonResponse(trials),
        ingest_ctgov_snapshot: () =>
          jsonResponse({
            snapshot_id: '11111111-1111-1111-1111-111111111111',
            inserted: true,
            events_emitted: 2,
            changes_recorded: 2,
          }),
        bulk_update_last_polled: () => jsonResponse(1),
        record_sync_run: () => jsonResponse('22222222-2222-2222-2222-222222222222'),
      }),
      ctgovSummaryHandler(() => jsonResponse({ studies: [summaryStudy('NCT01', '2026-04-15')] })),
      ctgovStudyHandler(() =>
        jsonResponse({
          protocolSection: {
            identificationModule: { nctId: 'NCT01' },
            statusModule: { lastUpdatePostDateStruct: { date: '2026-04-15' } },
          },
        })
      ),
      // Custom history handler that returns one entry with statusModule label,
      // so we can pin module-hint forwarding through to the ingest call.
      (req: Request) => {
        if (!req.url.match(/^https:\/\/ctgov\.test\/api\/int\/studies\/[^/]+\/history$/))
          return null;
        return jsonResponse({
          changes: [{ version: 1, date: '2026-04-15', moduleLabels: ['statusModule'] }],
        });
      },
    ]);

    const summary = await runScheduledSync(makeEnv());

    expect(summary.status).toBe('success');
    expect(summary.snapshots_written).toBe(1);
    expect(summary.events_emitted).toBe(2);
    expect(summary.ncts_with_changes).toBe(1);
    expect(summary.errors_count).toBe(0);

    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(1);
    expect(ingestCalls[0].body['p_secret']).toBe('test-secret');
    expect(ingestCalls[0].body['p_trial_id']).toBe('t1');
    expect(ingestCalls[0].body['p_space_id']).toBe('s1');
    expect(ingestCalls[0].body['p_nct_id']).toBe('NCT01');
    expect(ingestCalls[0].body['p_post_date']).toBe('2026-04-15');
    expect(ingestCalls[0].body['p_fetched_via']).toBe('v2_poll');
    // Module hints are deliberately NOT forwarded today (always null) because
    // CT.gov returns moduleLabels as display strings ("Study Status") that
    // don't match the SQL filter's path segments ("statusModule"). Forwarding
    // them caused `_compute_field_diffs` to drop every diff. See poller.ts.
    expect(ingestCalls[0].body['p_module_hints']).toBeNull();

    const bulkCalls = harness.rpcCalls.filter((c) => c.fn === 'bulk_update_last_polled');
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0].body['p_trial_ids']).toEqual(['t1']);

    const recordCalls = harness.rpcCalls.filter((c) => c.fn === 'record_sync_run');
    expect(recordCalls[0].body['p_status']).toBe('success');
    expect(recordCalls[0].body['p_snapshots_written']).toBe(1);
    expect(recordCalls[0].body['p_events_emitted']).toBe(2);
  });

  it('one trial fails ingestion: continues, status=partial', async () => {
    const trials = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-03-01',
        latest_ctgov_version: null,
      },
      {
        trial_id: 't2',
        space_id: 's2',
        nct_id: 'NCT02',
        last_update_posted_date: '2026-03-01',
        latest_ctgov_version: null,
      },
    ];

    let ingestSeq = 0;
    const harness = installFetch([
      rpcHandler({
        get_trials_for_polling: () => jsonResponse(trials),
        ingest_ctgov_snapshot: () => {
          ingestSeq += 1;
          if (ingestSeq === 1) {
            return jsonResponse({ code: 'XX000', message: 'boom' }, 500);
          }
          return jsonResponse({
            snapshot_id: '11111111-1111-1111-1111-111111111111',
            inserted: true,
            events_emitted: 1,
            changes_recorded: 1,
          });
        },
        bulk_update_last_polled: () => jsonResponse(1),
        record_sync_run: () => jsonResponse('22222222-2222-2222-2222-222222222222'),
      }),
      ctgovSummaryHandler(() =>
        jsonResponse({
          studies: [summaryStudy('NCT01', '2026-04-15'), summaryStudy('NCT02', '2026-04-15')],
        })
      ),
      ctgovStudyHandler((nctId) =>
        jsonResponse({
          protocolSection: {
            identificationModule: { nctId },
            statusModule: { lastUpdatePostDateStruct: { date: '2026-04-15' } },
          },
        })
      ),
      ctgovHistoryHandler(),
    ]);

    const summary = await runScheduledSync(makeEnv());

    expect(summary.status).toBe('partial');
    expect(summary.errors_count).toBe(1);
    expect(summary.snapshots_written).toBe(1);
    expect(summary.events_emitted).toBe(1);

    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(2);

    // Only the successfully ingested trial gets bulk-polled.
    const bulkCalls = harness.rpcCalls.filter((c) => c.fn === 'bulk_update_last_polled');
    expect(bulkCalls).toHaveLength(1);
    const polled = bulkCalls[0].body['p_trial_ids'] as string[];
    expect(polled).toContain('t2');
    expect(polled).not.toContain('t1');

    const recordCalls = harness.rpcCalls.filter((c) => c.fn === 'record_sync_run');
    expect(recordCalls[0].body['p_status']).toBe('partial');
    expect(recordCalls[0].body['p_errors_count']).toBe(1);
  });

  it('watermark batch fails: skips ingest, leaves last_polled unchanged, status=failed', async () => {
    const trials = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-04-01',
        latest_ctgov_version: null,
      },
      {
        trial_id: 't2',
        space_id: 's1',
        nct_id: 'NCT02',
        last_update_posted_date: '2026-03-15',
        latest_ctgov_version: null,
      },
      {
        trial_id: 't3',
        space_id: 's2',
        nct_id: 'NCT03',
        last_update_posted_date: '2026-02-20',
        latest_ctgov_version: null,
      },
    ];

    const harness = installFetch([
      rpcHandler({
        get_trials_for_polling: () => jsonResponse(trials),
        bulk_update_last_polled: () => jsonResponse(0),
        record_sync_run: () => jsonResponse('22222222-2222-2222-2222-222222222222'),
      }),
      ctgovSummaryHandler(() => new Response('', { status: 503 })),
      ctgovHistoryHandler(),
    ]);

    const summary = await runScheduledSync(makeEnv());

    expect(summary.status).toBe('failed');
    expect(summary.errors_count).toBeGreaterThan(0);
    expect(summary.snapshots_written).toBe(0);

    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(0);

    // bulk_update_last_polled either not called, or called with empty array.
    const bulkCalls = harness.rpcCalls.filter((c) => c.fn === 'bulk_update_last_polled');
    if (bulkCalls.length > 0) {
      expect(bulkCalls[0].body['p_trial_ids']).toEqual([]);
    }

    const recordCalls = harness.rpcCalls.filter((c) => c.fn === 'record_sync_run');
    expect(recordCalls[0].body['p_status']).toBe('failed');
    expect(recordCalls[0].body['p_errors_count']).toBeGreaterThan(0);
  });

  it('404 from CT.gov fetchStudy: marks polled, errors_count reflects, status=partial', async () => {
    const trials = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-03-01',
        latest_ctgov_version: null,
      },
    ];

    const harness = installFetch([
      rpcHandler({
        get_trials_for_polling: () => jsonResponse(trials),
        bulk_update_last_polled: () => jsonResponse(1),
        record_sync_run: () => jsonResponse('22222222-2222-2222-2222-222222222222'),
      }),
      ctgovSummaryHandler(() => jsonResponse({ studies: [summaryStudy('NCT01', '2026-04-15')] })),
      ctgovStudyHandler(() => new Response('', { status: 404 })),
      ctgovHistoryHandler(),
    ]);

    const summary = await runScheduledSync(makeEnv());

    expect(summary.snapshots_written).toBe(0);
    expect(summary.errors_count).toBe(1);
    expect(summary.status).toBe('partial');

    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(0);

    // The 404 trial is still bulk-polled so it does not retry tomorrow.
    const bulkCalls = harness.rpcCalls.filter((c) => c.fn === 'bulk_update_last_polled');
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0].body['p_trial_ids']).toEqual(['t1']);
  });

  it('version falls back to latest_ctgov_version + 1 when /api/int/ is 404', async () => {
    // /api/int/.../history is unreachable in many production paths (auth-walled,
    // rate-limited, or simply 404). Without a fallback, ingest collides on the
    // (trial_id, ctgov_version) unique constraint at version=1 forever and
    // last_update_posted_date never advances. The DB-derived counter restores
    // monotonicity per trial.
    const trials = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-03-01',
        latest_ctgov_version: 5,
      },
    ];

    const harness = installFetch([
      rpcHandler({
        get_trials_for_polling: () => jsonResponse(trials),
        ingest_ctgov_snapshot: () =>
          jsonResponse({
            snapshot_id: '11111111-1111-1111-1111-111111111111',
            inserted: true,
            events_emitted: 1,
            changes_recorded: 1,
          }),
        bulk_update_last_polled: () => jsonResponse(1),
        record_sync_run: () => jsonResponse('22222222-2222-2222-2222-222222222222'),
      }),
      ctgovSummaryHandler(() => jsonResponse({ studies: [summaryStudy('NCT01', '2026-04-15')] })),
      ctgovStudyHandler(() =>
        jsonResponse({
          protocolSection: {
            identificationModule: { nctId: 'NCT01' },
            statusModule: { lastUpdatePostDateStruct: { date: '2026-04-15' } },
          },
        })
      ),
      ctgovHistoryHandler(),
    ]);

    const summary = await runScheduledSync(makeEnv());

    expect(summary.status).toBe('success');
    expect(summary.snapshots_written).toBe(1);

    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(1);
    // Fallback: latest_ctgov_version (5) + 1 = 6.
    expect(ingestCalls[0].body['p_version']).toBe(6);
  });
});

describe('runManualBackfill', () => {
  it('happy path: ingests every requested NCT regardless of watermark', async () => {
    const trials = [
      {
        trial_id: 't1',
        space_id: 's1',
        nct_id: 'NCT01',
        last_update_posted_date: '2026-04-15',
        latest_ctgov_version: null,
      },
      {
        trial_id: 't2',
        space_id: 's1',
        nct_id: 'NCT02',
        last_update_posted_date: '2026-04-15',
        latest_ctgov_version: null,
      },
      // Extra trial in the queue that should be filtered out.
      {
        trial_id: 't3',
        space_id: 's2',
        nct_id: 'NCT99',
        last_update_posted_date: '2026-04-15',
        latest_ctgov_version: null,
      },
    ];

    const harness = installFetch([
      rpcHandler({
        get_trials_for_polling: () => jsonResponse(trials),
        ingest_ctgov_snapshot: () =>
          jsonResponse({
            snapshot_id: '11111111-1111-1111-1111-111111111111',
            inserted: true,
            events_emitted: 1,
            changes_recorded: 1,
          }),
        bulk_update_last_polled: () => jsonResponse(2),
        record_sync_run: () => jsonResponse('22222222-2222-2222-2222-222222222222'),
      }),
      ctgovStudyHandler((nctId) =>
        jsonResponse({
          protocolSection: {
            identificationModule: { nctId },
            statusModule: { lastUpdatePostDateStruct: { date: '2026-04-15' } },
          },
        })
      ),
      ctgovHistoryHandler(),
      // No summary handler: manual backfill must not consult the watermark API.
    ]);

    const summary = await runManualBackfill(makeEnv(), ['NCT01', 'NCT02']);

    expect(summary.status).toBe('success');
    expect(summary.snapshots_written).toBe(2);
    expect(summary.events_emitted).toBe(2);
    expect(summary.errors_count).toBe(0);

    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(2);
    const ingestedNcts = ingestCalls.map((c) => c.body['p_nct_id']).sort();
    expect(ingestedNcts).toEqual(['NCT01', 'NCT02']);
    for (const c of ingestCalls) {
      expect(c.body['p_secret']).toBe('test-secret');
      expect(c.body['p_fetched_via']).toBe('manual_sync');
    }

    // No CT.gov summary calls: the watermark layer is skipped.
    const summaryCalls = harness.ctgovCalls.filter((u) =>
      u.startsWith(`${CTGOV_BASE_URL}/api/v2/studies?`)
    );
    expect(summaryCalls).toHaveLength(0);

    const recordCalls = harness.rpcCalls.filter((c) => c.fn === 'record_sync_run');
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].body['p_status']).toBe('success');
    expect(recordCalls[0].body['p_snapshots_written']).toBe(2);
  });

  it('flags unknown NCTs (no trial row) as per-NCT errors', async () => {
    // Operator asks to backfill an NCT that has no trial row. Previously this
    // silently no-op'd and reported success; now each unknown NCT is recorded
    // as an error with kind=unknown_nct so the run reflects what happened.
    const harness = installFetch([
      rpcHandler({
        // Empty queue: no trials match the requested NCT.
        get_trials_for_polling: () => jsonResponse([]),
        record_sync_run: () => jsonResponse('22222222-2222-2222-2222-222222222222'),
      }),
    ]);

    const summary = await runManualBackfill(makeEnv(), ['NCT01234567']);

    expect(summary.errors_count).toBe(1);
    expect(summary.snapshots_written).toBe(0);
    expect(summary.error_summary).not.toBeNull();
    const errorSummary = summary.error_summary as { errors: Array<Record<string, unknown>> };
    expect(errorSummary.errors).toHaveLength(1);
    expect(errorSummary.errors[0]['nct_id']).toBe('NCT01234567');
    expect(errorSummary.errors[0]['kind']).toBe('unknown_nct');
    // Every requested NCT is unknown -> nothing succeeded -> failed.
    expect(summary.status).toBe('failed');

    // No CT.gov calls and no ingest calls: there's nothing to fetch.
    const ingestCalls = harness.rpcCalls.filter((c) => c.fn === 'ingest_ctgov_snapshot');
    expect(ingestCalls).toHaveLength(0);
    expect(harness.ctgovCalls).toHaveLength(0);

    const recordCalls = harness.rpcCalls.filter((c) => c.fn === 'record_sync_run');
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].body['p_status']).toBe('failed');
    expect(recordCalls[0].body['p_errors_count']).toBe(1);
  });
});
