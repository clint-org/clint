/**
 * Lightweight markdown renderer for primary intelligence display blocks.
 *
 * The authoring path uses ProseMirror, but on the read path we only need
 * to surface paragraphs, bold, italic, lists, and links. Pulling in a
 * full markdown library for that would bloat the bundle, so this is a
 * deliberate, escape-aware subset. Unknown syntax is preserved as plain
 * text. Output is sanitised by escaping HTML before applying inline
 * patterns and only emitting a known tag set.
 */

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ESCAPE[ch] ?? ch);
}

function applyInline(escaped: string): string {
  // Inline code first: `text` -- contents are already escaped, just wrap.
  let out = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic: *text* or _text_ (avoid colliding with bold patterns).
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  // Links: [text](url) -- only allow http(s) and mailto schemes.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safe = /^(https?:|mailto:)/i.test(url) ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

/**
 * Render a small subset of markdown to safe HTML. Supports paragraphs,
 * bullet/ordered lists (single level), bold, italic, inline code, and
 * links. Returns an empty string when given empty input.
 */
export function renderMarkdownInline(md: string): string {
  if (!md || !md.trim()) return '';
  const lines = md.split(/\r?\n/);
  const blocks: string[] = [];
  let para: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const text = applyInline(escapeHtml(para.join(' ')));
      blocks.push(`<p>${text}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listType && listItems.length) {
      const tag = listType;
      const items = listItems
        .map((it) => `<li>${applyInline(escapeHtml(it))}</li>`)
        .join('');
      blocks.push(`<${tag}>${items}</${tag}>`);
    }
    listType = null;
    listItems = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(bullet[1]);
      continue;
    }
    if (numbered) {
      flushPara();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(numbered[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks.join('\n');
}
