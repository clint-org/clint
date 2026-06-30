import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AI_CALL_OUTCOMES, classifyLlmFailure, isLlmAbort } from './call-outcome';

describe('call-outcome', () => {
  describe('isLlmAbort', () => {
    it('recognizes the Anthropic SDK abort error (whose .name is "Error", not "AbortError")', () => {
      const e = new Anthropic.APIUserAbortError();
      // Guard against the original bug: the SDK abort error reports name="Error"
      // and message "Request was aborted.", so an `e.name === 'AbortError'` check
      // silently misses it. instanceof is the reliable signal.
      expect(e.name).not.toBe('AbortError');
      expect(isLlmAbort(e)).toBe(true);
    });

    it('recognizes a DOMException AbortError (fetch/AbortController abort)', () => {
      expect(isLlmAbort(new DOMException('Aborted', 'AbortError'))).toBe(true);
    });

    it('recognizes a plain Error named AbortError', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      expect(isLlmAbort(e)).toBe(true);
    });

    it('does not treat an ordinary error as an abort', () => {
      expect(isLlmAbort(new Error('boom'))).toBe(false);
      expect(isLlmAbort('boom')).toBe(false);
      expect(isLlmAbort(null)).toBe(false);
    });
  });

  describe('classifyLlmFailure', () => {
    it('maps an SDK abort to a constraint-valid "timeout" outcome', () => {
      const outcome = classifyLlmFailure(new Anthropic.APIUserAbortError());
      expect(outcome).toBe('timeout');
      expect(AI_CALL_OUTCOMES).toContain(outcome);
    });

    it('maps a non-abort failure to "parse_failed"', () => {
      const outcome = classifyLlmFailure(new Error('bad json'));
      expect(outcome).toBe('parse_failed');
      expect(AI_CALL_OUTCOMES).toContain(outcome);
    });

    it('never returns the invalid "error" outcome that the DB CHECK constraint rejects', () => {
      // The original NCT-handler bug closed failures with outcome:'error', which is
      // absent from ai_calls.outcome's CHECK constraint -> the UPDATE threw and the
      // row stranded at PENDING. Every classified outcome must be a permitted value.
      for (const e of [new Anthropic.APIUserAbortError(), new Error('x'), 'str', null]) {
        const outcome = classifyLlmFailure(e);
        expect(AI_CALL_OUTCOMES).toContain(outcome);
        expect(outcome).not.toBe('error');
      }
    });
  });

  it('AI_CALL_OUTCOMES matches the ai_calls.outcome CHECK constraint exactly', () => {
    // Mirror of supabase/migrations/20260526100200_create_ai_calls.sql. If the DB
    // constraint gains/loses a value, this assertion forces this list to follow so
    // the worker can never write an outcome the DB will reject.
    expect([...AI_CALL_OUTCOMES].sort()).toEqual(
      [
        'cancelled',
        'cost_capped',
        'fetch_failed',
        'parse_failed',
        'pending',
        'rate_limited',
        'success',
        'timeout',
      ].sort()
    );
  });
});
