import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as supabase from '../supabase';
import { closeAiCall } from './ai-call-close';

vi.mock('../supabase', () => ({ callRpc: vi.fn() }));

const callRpc = vi.mocked(supabase.callRpc);
const cfg = { url: 'http://local', anonKey: 'anon' } as supabase.SupabaseConfig;
const env = { EXTRACT_SOURCE_WORKER_SECRET: 'secret' } as unknown as Parameters<typeof closeAiCall>[1];

function lastCloseArgs(callIndex: number): Record<string, unknown> {
  return callRpc.mock.calls[callIndex][3] as Record<string, unknown>;
}

describe('closeAiCall (issue #162 hardening)', () => {
  beforeEach(() => callRpc.mockReset());

  it('closes once with the given outcome when the RPC succeeds (no fallback)', async () => {
    callRpc.mockResolvedValueOnce(undefined);
    await closeAiCall(cfg, env, 'call-1', 'success', 1200, 100, 50, null, { ok: true });

    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(lastCloseArgs(0).p_outcome).toBe('success');
    expect(lastCloseArgs(0).p_output).toEqual({ ok: true });
  });

  it('never leaves the row PENDING: retries a constraint-valid outcome with a minimal payload when the first close throws', async () => {
    // Simulate the DB rejecting the first close (e.g. an oversized output blob).
    callRpc.mockRejectedValueOnce(new Error('payload too large')).mockResolvedValueOnce(undefined);
    await closeAiCall(cfg, env, 'call-2', 'timeout', 60000, 0, 0, 'Request was aborted.', {
      huge: 'x'.repeat(10),
    });

    expect(callRpc).toHaveBeenCalledTimes(2);
    // A VALID outcome is preserved on retry; the payload is dropped.
    expect(lastCloseArgs(1).p_outcome).toBe('timeout');
    expect(lastCloseArgs(1).p_output).toBeNull();
    expect(lastCloseArgs(1).p_warnings).toBeNull();
  });

  it('coerces an invalid outcome to a constraint-valid terminal value on the fallback close', async () => {
    // The original bug: outcome 'error' is rejected by the CHECK constraint.
    callRpc.mockRejectedValueOnce(new Error('violates check constraint')).mockResolvedValueOnce(undefined);
    await closeAiCall(cfg, env, 'call-3', 'error', 500, 0, 0, 'no_text_block');

    expect(callRpc).toHaveBeenCalledTimes(2);
    expect(lastCloseArgs(1).p_outcome).toBe('parse_failed');
  });

  it('does not throw even if the fallback close also fails (logs and gives up)', async () => {
    callRpc
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down too'));
    await expect(
      closeAiCall(cfg, env, 'call-4', 'timeout', 60000, 0, 0, 'aborted')
    ).resolves.toBeUndefined();
    expect(callRpc).toHaveBeenCalledTimes(2);
  });
});
