import Anthropic from '@anthropic-ai/sdk';

/**
 * The permitted values of the `ai_calls.outcome` CHECK constraint
 * (supabase/migrations/20260526100200_create_ai_calls.sql). Writing any value
 * outside this set makes `ai_call_close`'s UPDATE raise a constraint violation,
 * which strands the row at `pending`. Keep this in lockstep with the migration;
 * `call-outcome.spec.ts` asserts the two match.
 */
export const AI_CALL_OUTCOMES = [
  'pending',
  'success',
  'fetch_failed',
  'parse_failed',
  'timeout',
  'cost_capped',
  'rate_limited',
  'cancelled',
] as const;

export type AiCallOutcome = (typeof AI_CALL_OUTCOMES)[number];

/**
 * True when a thrown value is an LLM-call abort (our `LLM_TIMEOUT_MS` timer
 * firing on the AbortController).
 *
 * The Anthropic SDK throws `APIUserAbortError` on signal abort, and that error's
 * `.name` is `"Error"` (not `"AbortError"`) with message `"Request was aborted."`.
 * An `e.name === 'AbortError'` check therefore misses it and mislabels a genuine
 * timeout as a parse failure, so we match the SDK type via `instanceof` and also
 * accept the standard DOMException/Error AbortError shapes for completeness.
 */
export function isLlmAbort(e: unknown): boolean {
  return (
    e instanceof Anthropic.APIUserAbortError ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

/**
 * Classify a thrown LLM-call failure into a constraint-valid terminal outcome:
 * a timeout for an abort, otherwise a parse failure. Never returns a value the
 * `ai_calls.outcome` CHECK constraint would reject.
 */
export function classifyLlmFailure(e: unknown): AiCallOutcome {
  return isLlmAbort(e) ? 'timeout' : 'parse_failed';
}
