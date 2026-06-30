import type { Env } from '../index';
import { callRpc, type SupabaseConfig } from '../supabase';
import { AI_CALL_OUTCOMES } from './call-outcome';

/**
 * Close an `ai_calls` row at a terminal outcome. The row is opened by
 * `ai_call_open` and MUST always reach a terminal state here -- a row left at
 * `pending` is invisible-failure debt in the super-admin AI Usage log.
 *
 * Hardening (issue #162): the original implementation swallowed any close error
 * in an empty `catch`, so an invalid outcome (e.g. the removed `'error'` value,
 * which the `ai_calls.outcome` CHECK constraint rejects) stranded the row at
 * PENDING forever with no diagnostics. We now log the real exception and make a
 * best-effort second close with a guaranteed constraint-valid outcome and a
 * minimal payload, so no row stays PENDING even if the first close is rejected.
 */
export async function closeAiCall(
  cfg: SupabaseConfig,
  env: Env,
  aiCallId: string,
  outcome: string,
  durationMs: number,
  promptTokens: number | null,
  completionTokens: number | null,
  errorMessage: string | null,
  output?: unknown,
  warnings?: string[]
): Promise<void> {
  try {
    await callRpc(cfg, null, 'ai_call_close', {
      p_secret: env.EXTRACT_SOURCE_WORKER_SECRET,
      p_ai_call_id: aiCallId,
      p_outcome: outcome,
      p_prompt_tokens: promptTokens,
      p_completion_tokens: completionTokens,
      p_duration_ms: durationMs,
      p_output: output ?? null,
      p_warnings: warnings ?? null,
      p_error_code: errorMessage ? outcome : null,
      p_error_message: errorMessage,
    });
    return;
  } catch (e) {
    // Log the REAL exception (not a generic message) so a recurring close
    // failure is diagnosable from Worker logs instead of vanishing.
    console.error(`Failed to close ai_call ${aiCallId} with outcome '${outcome}':`, e);
  }

  // Best-effort fallback: guarantee the row leaves PENDING. Drop the
  // (possibly oversized/invalid) output payload, and coerce an unknown outcome
  // to a constraint-valid terminal value while preserving a valid one as-is.
  const safeOutcome = (AI_CALL_OUTCOMES as readonly string[]).includes(outcome)
    ? outcome
    : 'parse_failed';
  try {
    await callRpc(cfg, null, 'ai_call_close', {
      p_secret: env.EXTRACT_SOURCE_WORKER_SECRET,
      p_ai_call_id: aiCallId,
      p_outcome: safeOutcome,
      p_prompt_tokens: promptTokens,
      p_completion_tokens: completionTokens,
      p_duration_ms: durationMs,
      p_output: null,
      p_warnings: null,
      p_error_code: 'close_retry',
      p_error_message: errorMessage ?? `forced terminal close (original outcome '${outcome}')`,
    });
  } catch (e) {
    console.error(`Best-effort terminal close ALSO failed for ai_call ${aiCallId}:`, e);
  }
}
