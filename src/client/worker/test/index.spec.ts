import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../index';

const SUPABASE_URL = 'https://stub.supabase.co';

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  ALLOWED_APEXES: string;
  UPLOAD_LIMITER: { limit: (k: { key: string }) => Promise<{ success: boolean }> };
  DOWNLOAD_LIMITER: { limit: (k: { key: string }) => Promise<{ success: boolean }> };
  CTGOV_BASE_URL: string;
  CTGOV_BATCH_SIZE: string;
  CTGOV_PARALLEL_FETCHES: string;
  CTGOV_WORKER_SECRET: string;
};

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKID',
    R2_SECRET_ACCESS_KEY: 'SECRET',
    R2_BUCKET: 'clint-materials',
    ALLOWED_APEXES: 'clintapp.com',
    UPLOAD_LIMITER: { limit: async () => ({ success: true }) },
    DOWNLOAD_LIMITER: { limit: async () => ({ success: true }) },
    CTGOV_BASE_URL: 'https://clinicaltrials.gov',
    CTGOV_BATCH_SIZE: '100',
    CTGOV_PARALLEL_FETCHES: '10',
    CTGOV_WORKER_SECRET: 'shh',
    ...over,
  };
}

const VALID_BEARER =
  'Bearer ' +
  (() => {
    const enc = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${enc({ alg: 'HS256' })}.${enc({ sub: 'user-1' })}.sig`;
  })();

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockSupabaseFetch(handler: (req: Request) => Response | Promise<Response>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      if (req.url.startsWith(SUPABASE_URL)) {
        return handler(req);
      }
      // For non-Supabase URLs (e.g. AWS SDK presign check), delegate to real fetch
      // or throw -- presigning is computed locally so this should not be reached.
      throw new Error(`unexpected fetch: ${req.url}`);
    }
  );
}

describe('POST /api/materials/sign-upload', () => {
  it('returns 401 when JWT is missing', async () => {
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://pfizer.clintapp.com' },
      body: JSON.stringify({ material_id: 'aaaa-aaaa' }),
    });
    mockSupabaseFetch(
      () => new Response(JSON.stringify({ message: 'JWT required' }), { status: 401 })
    );
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns presigned PUT URL on success', async () => {
    mockSupabaseFetch(
      () =>
        new Response(
          JSON.stringify({
            space_id: '11111111-1111-1111-1111-111111111111',
            material_id: '22222222-2222-2222-2222-222222222222',
            file_name: 'test.pdf',
            mime_type: 'application/pdf',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ material_id: '22222222-2222-2222-2222-222222222222' }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string };
    // The AWS SDK builds virtual-hosted-style URLs:
    // https://<bucket>.<accountId>.r2.cloudflarestorage.com/<key>
    expect(body.url).toMatch(/^https:\/\/[^.]+\.acct\.r2\.cloudflarestorage\.com\//);
    expect(body.key).toBe(
      '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/test.pdf'
    );
  });

  it('returns 429 when rate limit is hit', async () => {
    const env = makeEnv({
      UPLOAD_LIMITER: { limit: async () => ({ success: false }) },
    });
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ material_id: 'm' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('maps Supabase 42501 to 403', async () => {
    mockSupabaseFetch(
      () => new Response(JSON.stringify({ code: '42501', message: 'forbidden' }), { status: 400 })
    );
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ material_id: 'm' }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });
});

describe('OPTIONS preflight', () => {
  it('returns 204 for allowed origin', async () => {
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pfizer.clintapp.com' },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(204);
  });
  it('returns 403 for disallowed origin', async () => {
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com' },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });
});

describe('non-api routes', () => {
  it('falls through to 404 (assets handler in production)', async () => {
    const req = new Request('https://x/some/spa/route', {
      method: 'GET',
      headers: { Origin: 'https://pfizer.clintapp.com' },
    });
    const res = await worker.fetch(req, makeEnv());
    // In tests the assets binding is absent; we expect a 404.
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/ctgov-backfill', () => {
  it('returns 401 without Authorization header', async () => {
    const req = new Request('https://x/admin/ctgov-backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://pfizer.clintapp.com' },
      body: JSON.stringify({ nct_ids: ['NCT01'] }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 403 when is_platform_admin returns false', async () => {
    mockSupabaseFetch((req) => {
      if (req.url.endsWith('/rpc/is_platform_admin')) {
        return new Response(JSON.stringify(false), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected rpc: ${req.url}`);
    });
    const req = new Request('https://x/admin/ctgov-backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ nct_ids: ['NCT01'] }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it('returns 400 on missing nct_ids', async () => {
    mockSupabaseFetch((req) => {
      if (req.url.endsWith('/rpc/is_platform_admin')) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected rpc: ${req.url}`);
    });
    const req = new Request('https://x/admin/ctgov-backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({}),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('nct_ids_required');
  });

  it('returns 200 with run summary when admin requests an unknown NCT', async () => {
    // is_platform_admin -> true; get_trials_for_polling -> empty (so the
    // requested NCT is unknown and the run records partial/failed status
    // depending on inputs but always returns 200 + summary).
    mockSupabaseFetch((req) => {
      if (req.url.endsWith('/rpc/is_platform_admin')) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (req.url.endsWith('/rpc/get_trials_for_polling')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (req.url.endsWith('/rpc/record_sync_run')) {
        return new Response(JSON.stringify('00000000-0000-0000-0000-000000000000'), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected rpc: ${req.url}`);
    });
    const req = new Request('https://x/admin/ctgov-backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ nct_ids: ['NCT99999999'] }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      trials_checked: number;
      ncts_with_changes: number;
      errors_count: number;
    };
    expect(body.trials_checked).toBe(0);
    expect(body.ncts_with_changes).toBe(0);
    // Unknown NCT is logged as a per-NCT error -> errors_count >= 1.
    expect(body.errors_count).toBeGreaterThanOrEqual(1);
    expect(['failed', 'partial', 'success']).toContain(body.status);
  });
});

describe('scheduled export', () => {
  it('exposes a scheduled handler', () => {
    expect(typeof worker.scheduled).toBe('function');
  });
});
