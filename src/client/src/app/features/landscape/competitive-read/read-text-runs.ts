/**
 * Parses the controlled HTML a READ segment emits into safe text runs so the
 * strip can render it without binding to [innerHTML]. The markup is fully
 * produced by this module's build layer and is limited to:
 *   - plain text (with &amp; / &lt; / &gt; entity escapes from escapeName)
 *   - <strong>...</strong>            (secondary emphasis)
 *   - <strong class="leader-name">...</strong> (leader brand emphasis)
 *
 * Anything outside that grammar is treated as plain text, so the output is
 * always safe to interpolate as text content.
 */
export interface ReadTextRun {
  text: string;
  emphasis: 'none' | 'strong' | 'leader';
}

const STRONG_RE = /<strong(?:\s+class="([^"]*)")?>(.*?)<\/strong>/g;

function unescapeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseReadTextRuns(html: string): ReadTextRun[] {
  const runs: ReadTextRun[] = [];
  let lastIndex = 0;
  STRONG_RE.lastIndex = 0;

  const pushPlain = (raw: string) => {
    if (raw.length === 0) return;
    runs.push({ text: unescapeEntities(raw), emphasis: 'none' });
  };

  let match: RegExpExecArray | null;
  while ((match = STRONG_RE.exec(html)) !== null) {
    pushPlain(html.slice(lastIndex, match.index));
    const cls = match[1] ?? '';
    const inner = unescapeEntities(match[2]);
    runs.push({ text: inner, emphasis: cls.includes('leader-name') ? 'leader' : 'strong' });
    lastIndex = STRONG_RE.lastIndex;
  }
  pushPlain(html.slice(lastIndex));

  return runs;
}
