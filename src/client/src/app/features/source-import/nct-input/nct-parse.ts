const NCT_REGEX = /NCT\d{8}/gi;
const NCT_LIKE = /NCT\d{1,7}(?!\d)/gi;

export interface NctParseResult {
  valid: string[];
  malformed: string[];
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
