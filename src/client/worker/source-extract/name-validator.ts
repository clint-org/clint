const NON_ALNUM_SPACE_RE = /[^a-z0-9 ]/g;
const MULTI_SPACE_RE = /\s+/g;

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(NON_ALNUM_SPACE_RE, '')
    .replace(MULTI_SPACE_RE, ' ')
    .trim();
}

export function isNameSubstring(name: string, sourceText: string): boolean {
  return normalizeForMatch(sourceText).includes(normalizeForMatch(name));
}
