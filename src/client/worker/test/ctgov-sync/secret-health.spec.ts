import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCtgovSecretHealth } from '../../ctgov-sync/secret-health';

const SUPABASE_URL = 'https://stub.supabase.co';
const CORS = { 'X-Test': '1' };

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeEnv(over: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon',
    CTGOV_WORKER_SECRET: 'test-secret',
    ...over,
  } as never;
}

// Stub the PostgREST RPC fetch the handler makes and capture the calls.
function stubRpc(responder: () => Response) {
  const calls: { fn: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      const fn = req.url.substring(`${SUPABASE_URL}/rest/v1/rpc/`.length);
      const body = JSON.parse((await req.clone().text()) || '{}');
      calls.push({ fn, body });
      return responder();
    }
  );
  return calls;
}

describe('handleCtgovSecretHealth', () => {
  it('probes ctgov_secret_health with the worker secret and returns ok:true on match', async () => {
    const calls = stubRpc(
      () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const res = await handleCtgovSecretHealth(makeEnv(), CORS);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('ctgov_secret_health');
    expect(calls[0].body).toEqual({ p_secret: 'test-secret' });
    // CORS headers are forwarded so the browser/health caller is unblocked.
    expect(res.headers.get('X-Test')).toBe('1');
  });

  it('returns ok:false reason secret_mismatch when the RPC raises 42501', async () => {
    stubRpc(
      () =>
        new Response(JSON.stringify({ code: '42501', message: 'unauthorized' }), {
          status: 403,
        })
    );

    const res = await handleCtgovSecretHealth(makeEnv(), CORS);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; reason: string };
    expect(json.ok).toBe(false);
    expect(json.reason).toBe('secret_mismatch');
  });

  it('returns ok:false reason error on an unexpected RPC failure', async () => {
    stubRpc(
      () =>
        new Response(JSON.stringify({ code: 'XX000', message: 'boom' }), {
          status: 500,
        })
    );

    const res = await handleCtgovSecretHealth(makeEnv(), CORS);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; reason: string };
    expect(json.ok).toBe(false);
    expect(json.reason).toBe('error');
  });
});
