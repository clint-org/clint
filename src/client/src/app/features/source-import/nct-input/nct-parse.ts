const NCT_REGEX = /NCT\d{8}/gi;
const NCT_LIKE = /NCT\d{1,7}(?!\d)/gi;

// Maximum NCT IDs the worker accepts per import (mirrors MAX_NCTS in
// worker/source-extract/nct-handler.ts). Surfaced in the UI so the cap is shown
// as a running count rather than only rejected after the user exceeds it.
export const MAX_NCTS = 50;

export interface NctParseResult {
  valid: string[];
  malformed: string[];
}

export type NctCountSeverity = 'ok' | 'at-cap' | 'over';

export interface NctCountStatus {
  count: number;
  max: number;
  severity: NctCountSeverity;
  /** How many IDs are over the cap (0 when within the limit). */
  over: number;
}

// Classify the current valid-ID count against the cap so the input can warn as
// the user approaches (`at-cap`) and blocks past it (`over`) instead of only
// erroring on submit.
export function nctCountStatus(validCount: number, max = MAX_NCTS): NctCountStatus {
  const severity: NctCountSeverity =
    validCount > max ? 'over' : validCount === max ? 'at-cap' : 'ok';
  return { count: validCount, max, severity, over: Math.max(0, validCount - max) };
}

export function parseNctIds(raw: string): NctParseResult {
  const valid: string[] = [];
  const malformed: string[] = [];
  const seen = new Set<string>();

  const validMatches = raw.match(NCT_REGEX) ?? [];
  for (const m of validMatches) {
    const upper = m.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      valid.push(upper);
    }
  }

  const stripped = raw.replace(NCT_REGEX, '');
  const malformedMatches = stripped.match(NCT_LIKE) ?? [];
  for (const m of malformedMatches) {
    const upper = m.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      malformed.push(upper);
    }
  }

  return { valid, malformed };
}
