// Integration spec for the R2 drain against a real Miniflare-emulated R2
// binding. Complements queue.spec.ts (which mocks the R2 client interface)
// by proving the actual binding shape works end-to-end: the drain claims
// pending rows via RPC, calls env.MATERIALS_BUCKET.delete(key), and the
// object is actually gone from the bucket afterward.
//
// The three drain RPCs (claim_pending_r2_deletes, mark_r2_delete_succeeded,
// mark_r2_delete_failed) are mocked here because the worker test pool
// runs before the integration phase in run-all-tests.sh and we don't want
// test:worker to depend on live Supabase. The RPC wire layer is covered
// in queue.spec.ts; this spec focuses on the R2 wiring.

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainR2DeleteQueue, type R2DeleteClient } from '../../r2-drain/queue';

const SUPABASE_URL = 'https://stub.supabase.co';
const RPC_CLAIM = `${SUPABASE_URL}/rest/v1/rpc/claim_pending_r2_deletes`;
const RPC_SUCCEEDED = `${SUPABASE_URL}/rest/v1/rpc/mark_r2_delete_succeeded`;
const RPC_FAILED = `${SUPABASE_URL}/rest/v1/rpc/mark_r2_delete_failed`;
const WORKER_SECRET = 'r2-worker-secret';

interface FixtureRow {
  id: string;
  file_path: string;
  attempt_count: number;
  succeeded_at: string | null;
  last_error: string | null;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await emptyBucket();
});

async function emptyBucket(): Promise<void> {
  const list = await env.MATERIALS_BUCKET.list();
  for (const obj of list.objects) {
    await env.MATERIALS_BUCKET.delete(obj.key);
  }
}

function installRpcMock(rows: FixtureRow[]): {
  marked: Record<string, 'succeeded' | 'failed'>;
} {
  const marked: Record<string, 'succeeded' | 'failed'> = {};
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (method !== 'POST') {
      throw new Error(`unexpected method ${method} on ${url}`);
    }
    const bodyText = init?.body ? init.body.toString() : '';
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
    if (body['p_secret'] !== WORKER_SECRET) {
      return new Response(JSON.stringify({ code: '42501', message: 'unauthorized' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === RPC_CLAIM) {
      const claimed = rows
        .filter((r) => r.succeeded_at === null && r.attempt_count < 5)
        .map((r) => ({ id: r.id, file_path: r.file_path, attempt_count: r.attempt_count }));
      return new Response(JSON.stringify(claimed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === RPC_SUCCEEDED) {
      const id = body['p_id'] as string;
      const row = rows.find((r) => r.id === id);
      if (row) row.succeeded_at = new Date().toISOString();
      marked[id] = 'succeeded';
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === RPC_FAILED) {
      const id = body['p_id'] as string;
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.attempt_count = body['p_attempt_count'] as number;
        row.last_error = body['p_error'] as string;
      }
      marked[id] = 'failed';
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
  return { marked };
}

function makeRow(id: string, key: string, attempt_count = 0): FixtureRow {
  return { id, file_path: key, attempt_count, succeeded_at: null, last_error: null };
}

function envFor(): { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; R2_WORKER_SECRET: string } {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon-key',
    R2_WORKER_SECRET: WORKER_SECRET,
  };
}

function bindingClient(): R2DeleteClient {
  return {
    async delete(key: string): Promise<void> {
      await env.MATERIALS_BUCKET.delete(key);
    },
  };
}

describe('r2 drain against Miniflare R2 binding', () => {
  it('deletes the queued object from the bound bucket and marks the row succeeded', async () => {
    await env.MATERIALS_BUCKET.put('materials/space-a/m-1/brief.pdf', 'doc-body');
    const rows = [makeRow('row-1', 'materials/space-a/m-1/brief.pdf')];
    const { marked } = installRpcMock(rows);

    const summary = await drainR2DeleteQueue(envFor(), bindingClient());

    expect(summary).toEqual({ drained: 1, succeeded: 1, failed: 0, max_attempts_hit: 0 });
    expect(await env.MATERIALS_BUCKET.head('materials/space-a/m-1/brief.pdf')).toBeNull();
    expect(marked['row-1']).toBe('succeeded');
  });

  it('drains multiple objects in one pass', async () => {
    await env.MATERIALS_BUCKET.put('materials/space-a/m-1/a.pdf', 'a');
    await env.MATERIALS_BUCKET.put('materials/space-a/m-2/b.pdf', 'b');
    await env.MATERIALS_BUCKET.put('materials/space-b/m-3/c.pdf', 'c');
    const rows = [
      makeRow('row-1', 'materials/space-a/m-1/a.pdf'),
      makeRow('row-2', 'materials/space-a/m-2/b.pdf'),
      makeRow('row-3', 'materials/space-b/m-3/c.pdf'),
    ];
    installRpcMock(rows);

    const summary = await drainR2DeleteQueue(envFor(), bindingClient());

    expect(summary).toEqual({ drained: 3, succeeded: 3, failed: 0, max_attempts_hit: 0 });
    const list = await env.MATERIALS_BUCKET.list();
    expect(list.objects).toHaveLength(0);
  });

  it('treats deletion of an already-missing object as success (idempotency)', async () => {
    // No object in the bucket; row references a key that does not exist.
    const rows = [makeRow('row-1', 'materials/space-a/m-1/gone.pdf')];
    const { marked } = installRpcMock(rows);

    const summary = await drainR2DeleteQueue(envFor(), bindingClient());

    // R2 binding's delete is idempotent: deleting a missing key resolves.
    expect(summary).toEqual({ drained: 1, succeeded: 1, failed: 0, max_attempts_hit: 0 });
    expect(marked['row-1']).toBe('succeeded');
  });

  it('does not touch unrelated objects in the bucket', async () => {
    await env.MATERIALS_BUCKET.put('materials/space-a/m-1/queued.pdf', 'q');
    await env.MATERIALS_BUCKET.put('materials/space-z/m-9/keep.pdf', 'k');
    const rows = [makeRow('row-1', 'materials/space-a/m-1/queued.pdf')];
    installRpcMock(rows);

    await drainR2DeleteQueue(envFor(), bindingClient());

    expect(await env.MATERIALS_BUCKET.head('materials/space-a/m-1/queued.pdf')).toBeNull();
    const survivor = await env.MATERIALS_BUCKET.head('materials/space-z/m-9/keep.pdf');
    expect(survivor).not.toBeNull();
  });
});
