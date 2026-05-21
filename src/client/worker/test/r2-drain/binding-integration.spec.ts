// Integration spec for the R2 drain against a real Miniflare-emulated R2
// binding. Complements queue.spec.ts (which mocks the R2 client interface)
// by proving the actual binding shape works end-to-end: the drain reads
// pending rows, calls env.MATERIALS_BUCKET.delete(key), and the object
// is actually gone from the bucket afterward.
//
// PostgREST is still mocked here because the worker test pool runs before
// the integration phase in run-all-tests.sh (and we don't want test:worker
// to depend on a live Supabase). The Supabase wire layer is already
// well-covered in queue.spec.ts; this spec focuses on the R2 wiring.

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainR2DeleteQueue, type R2DeleteClient } from '../../r2-drain/queue';

const SUPABASE_URL = 'https://stub.supabase.co';
const TABLE_URL = `${SUPABASE_URL}/rest/v1/r2_pending_deletes`;

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

function installPostgrestMock(rows: FixtureRow[]): {
  patches: Record<string, Record<string, unknown>>;
} {
  const patches: Record<string, Record<string, unknown>> = {};
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (!url.startsWith(TABLE_URL)) {
      throw new Error(`unexpected fetch in test: ${method} ${url}`);
    }
    if (method === 'GET') {
      const pending = rows
        .filter((r) => r.succeeded_at === null && r.attempt_count < 5)
        .map((r) => ({ id: r.id, file_path: r.file_path, attempt_count: r.attempt_count }));
      return new Response(JSON.stringify(pending), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'PATCH') {
      const u = new URL(url);
      const idParam = u.searchParams.get('id');
      const id = idParam?.replace(/^eq\./, '') ?? '';
      const bodyText = init?.body ? init.body.toString() : '';
      const patch = JSON.parse(bodyText) as Record<string, unknown>;
      patches[id] = patch;
      const row = rows.find((r) => r.id === id);
      if (row) {
        if (typeof patch.succeeded_at === 'string') row.succeeded_at = patch.succeeded_at;
        if (typeof patch.attempt_count === 'number') row.attempt_count = patch.attempt_count;
        if (typeof patch.last_error === 'string') row.last_error = patch.last_error;
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected method ${method} on ${url}`);
  });
  return { patches };
}

function makeRow(id: string, key: string, attempt_count = 0): FixtureRow {
  return { id, file_path: key, attempt_count, succeeded_at: null, last_error: null };
}

function envFor(): { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; R2_BUCKET: string } {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    R2_BUCKET: 'clint-materials',
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
    const { patches } = installPostgrestMock(rows);

    const summary = await drainR2DeleteQueue(envFor(), bindingClient());

    expect(summary).toEqual({ drained: 1, succeeded: 1, failed: 0, max_attempts_hit: 0 });
    expect(await env.MATERIALS_BUCKET.head('materials/space-a/m-1/brief.pdf')).toBeNull();
    expect(patches['row-1']?.['succeeded_at']).toBeTypeOf('string');
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
    installPostgrestMock(rows);

    const summary = await drainR2DeleteQueue(envFor(), bindingClient());

    expect(summary).toEqual({ drained: 3, succeeded: 3, failed: 0, max_attempts_hit: 0 });
    const list = await env.MATERIALS_BUCKET.list();
    expect(list.objects).toHaveLength(0);
  });

  it('treats deletion of an already-missing object as success (idempotency)', async () => {
    // No object in the bucket; row references a key that does not exist.
    const rows = [makeRow('row-1', 'materials/space-a/m-1/gone.pdf')];
    const { patches } = installPostgrestMock(rows);

    const summary = await drainR2DeleteQueue(envFor(), bindingClient());

    // R2 binding's delete is idempotent: deleting a missing key resolves.
    expect(summary).toEqual({ drained: 1, succeeded: 1, failed: 0, max_attempts_hit: 0 });
    expect(patches['row-1']?.['succeeded_at']).toBeTypeOf('string');
  });

  it('does not touch unrelated objects in the bucket', async () => {
    await env.MATERIALS_BUCKET.put('materials/space-a/m-1/queued.pdf', 'q');
    await env.MATERIALS_BUCKET.put('materials/space-z/m-9/keep.pdf', 'k');
    const rows = [makeRow('row-1', 'materials/space-a/m-1/queued.pdf')];
    installPostgrestMock(rows);

    await drainR2DeleteQueue(envFor(), bindingClient());

    expect(await env.MATERIALS_BUCKET.head('materials/space-a/m-1/queued.pdf')).toBeNull();
    const survivor = await env.MATERIALS_BUCKET.head('materials/space-z/m-9/keep.pdf');
    expect(survivor).not.toBeNull();
  });
});
