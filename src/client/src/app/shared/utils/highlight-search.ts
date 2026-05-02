/**
 * Search-term highlighting helpers used by the intelligence feed and
 * other browse rows. The HTML variant assumes its input is trusted HTML
 * (already escaped by markdown-render or a similar producer); the plain
 * variant escapes its input first. Both wrap matches in
 * `<mark class="search-hit">` -- the visual style is owned by the global
 * `.search-hit` rule in styles.css so the tint stays consistent.
 */

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wrap occurrences of `query` in plain `text`, escaping HTML on the way. */
export function highlightPlain(text: string, query: string | null | undefined): string {
  const escaped = escapeHtml(text ?? '');
  const q = (query ?? '').trim();
  if (!q) return escaped;
  const re = new RegExp(escapeRegex(q), 'gi');
  return escaped.replace(re, (m) => `<mark class="search-hit">${m}</mark>`);
}

/**
 * Wrap occurrences of `query` in already-rendered HTML, leaving tag
 * tokens untouched. Matches are only wrapped inside text content.
 */
export function highlightHtml(html: string, query: string | null | undefined): string {
  const q = (query ?? '').trim();
  if (!q || !html) return html ?? '';
  const queryRe = escapeRegex(q);
  const tokenRe = new RegExp(`(<[^>]+>)|(${queryRe})`, 'gi');
  return html.replace(tokenRe, (_m, tag: string | undefined, hit: string | undefined) => {
    if (tag) return tag;
    return `<mark class="search-hit">${hit}</mark>`;
  });
}
