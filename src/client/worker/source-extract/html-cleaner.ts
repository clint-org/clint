export interface CleanResult {
  text: string;
  paywall_detected: boolean;
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g;

const BLOCK_STRIP_RE = /<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_STRIP_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

const PAYWALL_MARKERS = [
  '<meta name="robots" content="noindex"',
  'class="paywall"',
  'id="paywall"',
];

function detectPaywall(raw: string, cleanedLength: number): boolean {
  if (cleanedLength < 200) return true;
  const lower = raw.toLowerCase();
  return PAYWALL_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

export function cleanHtml(raw: string): CleanResult {
  const stripped = raw
    .replace(BLOCK_STRIP_RE, '')
    .replace(TAG_STRIP_RE, '')
    .replace(ENTITY_RE, (match) => ENTITY_MAP[match] ?? match)
    .replace(WHITESPACE_RE, ' ')
    .trim();

  return {
    text: stripped,
    paywall_detected: detectPaywall(raw, stripped.length),
  };
}
