import type { ParsedQuery, PrefixTokenChar } from '../models/palette.model';

const TOKENS = new Set<PrefixTokenChar>(['>', '@', '#', '!']);

export function parsePrefixToken(input: string): ParsedQuery {
  if (!input) {
    return { token: null, term: '' };
  }
  const first = input.charAt(0) as PrefixTokenChar;
  if (TOKENS.has(first)) {
    return { token: first, term: input.slice(1) };
  }
  return { token: null, term: input };
}
