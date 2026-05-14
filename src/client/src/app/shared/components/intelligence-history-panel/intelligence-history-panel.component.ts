import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { diffWords } from 'diff';

import {
  ENTITY_TYPE_LABEL,
  IntelligenceHistoryEvent,
  IntelligenceHistoryPayload,
  IntelligenceVersionRow,
  PrimaryIntelligence,
  PrimaryIntelligenceLink,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { diffLinks, LinksDiff } from './links-diff';
import { foldArchivedEvents, TimelineRow } from './history-timeline';

type VersionSection = 'headline' | 'summary' | 'implications' | 'links';

interface DiffSection {
  section: VersionSection;
  label: string;
  html?: string;
  links?: LinksDiff;
}

@Component({
  selector: 'app-intelligence-history-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './intelligence-history-panel.component.html',
})
export class IntelligenceHistoryPanelComponent {
  readonly payload = input.required<IntelligenceHistoryPayload>();
  readonly currentUserCanEdit = input<boolean>(false);
  readonly authorMap = input<Record<string, string>>({});

  readonly withdraw = output<{ id: string; changeNote: string }>();
  readonly purgeVersion = output<{ id: string; confirmation: string }>();
  readonly purgeAnchor = output<{ id: string; confirmation: string }>();
  readonly draftClicked = output<void>();

  protected readonly expanded = signal(false);
  protected readonly expandedEventIds = signal<ReadonlySet<string>>(new Set());

  private readonly diffCache = new Map<string, DiffSection[]>();

  constructor() {
    effect(() => {
      this.payload();
      this.diffCache.clear();
    });
  }

  protected readonly events = computed<IntelligenceHistoryEvent[]>(
    () => this.payload().events ?? []
  );
  protected readonly versions = computed<IntelligenceVersionRow[]>(
    () => this.payload().versions ?? []
  );
  protected readonly draft = computed<PrimaryIntelligence | null>(() => this.payload().draft);
  protected readonly current = computed<PrimaryIntelligence | null>(() => this.payload().current);

  protected readonly eventCount = computed(() => this.events().length);
  protected readonly versionCount = computed(() => this.versions().length);
  protected readonly canExpand = computed(() => this.eventCount() > 0);

  protected readonly latestPublished = computed<IntelligenceHistoryEvent | null>(() => {
    for (const e of [...this.events()].reverse()) {
      if (e.kind === 'published') return e;
    }
    return null;
  });

  protected readonly versionsById = computed<Record<string, IntelligenceVersionRow>>(() => {
    const out: Record<string, IntelligenceVersionRow> = {};
    for (const v of this.versions()) out[v.id] = v;
    return out;
  });

  protected readonly timeline = computed<TimelineRow[]>(() => foldArchivedEvents(this.events()));

  protected isEventExpanded(rowId: string): boolean {
    return this.expandedEventIds().has(rowId);
  }

  protected toggleEvent(rowId: string): void {
    this.expandedEventIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  protected toggle(): void {
    if (!this.canExpand()) return;
    this.expanded.update((v) => !v);
  }

  protected versionForEvent(event: IntelligenceHistoryEvent): IntelligenceVersionRow | null {
    return this.versionsById()[event.row_id] ?? null;
  }

  protected diffBaseFor(version: IntelligenceVersionRow): IntelligenceVersionRow | null {
    if (!version.diff_base_id) return null;
    return this.versionsById()[version.diff_base_id] ?? null;
  }

  /**
   * Renders the content sections of `version` with word-level inline diff
   * marks against `base` (or plain content if base is null). The Linked
   * entities section is structural, not textual: it shows added / removed
   * entries and per-field changes (relationship, gloss) since `base`.
   */
  protected renderDiff(
    version: IntelligenceVersionRow,
    base: IntelligenceVersionRow | null
  ): DiffSection[] {
    const cacheKey = `${version.id}::${base?.id ?? 'none'}`;
    const cached = this.diffCache.get(cacheKey);
    if (cached) return cached;

    const textSections: {
      key: Exclude<VersionSection, 'links'>;
      label: string;
      field: keyof IntelligenceVersionRow;
    }[] = [
      { key: 'headline', label: 'Headline', field: 'headline' },
      { key: 'summary', label: 'Summary', field: 'summary_md' },
      { key: 'implications', label: 'Implications', field: 'implications_md' },
    ];
    const out: DiffSection[] = [];
    for (const s of textSections) {
      const after = (version[s.field] as string) ?? '';
      if (!after.trim()) continue;
      const before = base ? ((base[s.field] as string) ?? '') : '';
      let html: string;
      if (!base) {
        html = renderMarkdownInline(after);
      } else if (s.key === 'headline') {
        // Headline is plain text, not markdown -- single-line word diff.
        html = renderWordDiff(before, after);
      } else {
        // Markdown fields: parse into blocks (paragraphs, list items) so
        // bullets and numbered lists render as <ul>/<ol> instead of leaking
        // their leading "- " / "1." into the diff output as raw text.
        html = renderBlockDiff(before, after);
      }
      out.push({ section: s.key, label: s.label, html });
    }
    const links = diffLinks(base?.links ?? null, version.links ?? []);
    if (
      links.added.length ||
      links.removed.length ||
      links.changed.length ||
      links.unchanged.length
    ) {
      out.push({ section: 'links', label: 'Linked entities', links });
    }
    this.diffCache.set(cacheKey, out);
    return out;
  }

  protected entityTypeLabel(type: PrimaryIntelligenceLink['entity_type']): string {
    return ENTITY_TYPE_LABEL[type];
  }

  protected linkLabel(link: PrimaryIntelligenceLink): string {
    return link.entity_name ?? `(deleted ${ENTITY_TYPE_LABEL[link.entity_type].toLowerCase()})`;
  }

  protected eventVersionChip(event: IntelligenceHistoryEvent): string | null {
    if (event.version_number == null) return null;
    return `v${event.version_number}`;
  }

  protected authorInitials(id: string | null | undefined): string {
    if (!id) return '';
    return this.authorMap()[id] ?? id.slice(0, 2).toUpperCase();
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected formatTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  protected eventKindLabel(kind: IntelligenceHistoryEvent['kind']): string {
    switch (kind) {
      case 'draft_started':
        return 'Draft';
      case 'published':
        return 'Published';
      case 'archived':
        return 'Archived';
      case 'withdrawn':
        return 'Withdrawn';
    }
  }

  protected isExpandable(kind: IntelligenceHistoryEvent['kind']): boolean {
    return kind === 'published' || kind === 'withdrawn';
  }

  protected hasDraft(): boolean {
    return this.draft() !== null && this.currentUserCanEdit();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderWordDiff(before: string, after: string): string {
  const parts = diffWords(before, after);
  return parts
    .map((p) => {
      const text = escapeHtml(p.value);
      if (p.added) return `<ins class="bg-brand-100 text-slate-900 no-underline">${text}</ins>`;
      if (p.removed) return `<del class="text-slate-500 line-through">${text}</del>`;
      return `<span>${text}</span>`;
    })
    .join('');
}

type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; text: string }
  | { kind: 'ol'; text: string };

function parseMdBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join(' ') });
      para = [];
    }
  };
  // Mirror renderMarkdownInline's unescape so backslash-escaped list markers
  // (legacy editor output) parse as list items here too.
  const normalized = md.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
  for (const raw of normalized.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (bullet) {
      flushPara();
      blocks.push({ kind: 'ul', text: bullet[1] });
    } else if (numbered) {
      flushPara();
      blocks.push({ kind: 'ol', text: numbered[1] });
    } else {
      para.push(line);
    }
  }
  flushPara();
  return blocks;
}

/**
 * Diff two markdown strings as a sequence of block-level units (paragraphs
 * and list items). Within matching blocks, fall back to word-level diff so
 * inline edits still highlight. Consecutive list items group into <ul>/<ol>
 * so leading "- " / "1." markers don't leak into the rendered output.
 *
 * Limitations:
 *   - Block alignment is positional, not Myers-style. Inserting a block in
 *     the middle re-aligns trailing blocks; rarely-shifted lists still read
 *     fine since each list item still shows its own added/removed state.
 *   - Inline bold/italic markers stay as raw text in changed blocks. Pre-
 *     processing them into <strong>/<em> would require diffing across HTML
 *     tag boundaries, which produces worse output in practice.
 */
function renderBlockDiff(before: string, after: string): string {
  const a = parseMdBlocks(before);
  const b = parseMdBlocks(after);

  const segments: { kind: MdBlock['kind']; html: string }[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const bi = a[i];
    const ai = b[i];
    if (bi && ai && bi.kind === ai.kind) {
      segments.push({ kind: ai.kind, html: renderWordDiff(bi.text, ai.text) });
    } else {
      if (bi) {
        segments.push({
          kind: bi.kind,
          html: `<del class="text-slate-500 line-through">${escapeHtml(bi.text)}</del>`,
        });
      }
      if (ai) {
        segments.push({
          kind: ai.kind,
          html: `<ins class="bg-brand-100 text-slate-900 no-underline">${escapeHtml(ai.text)}</ins>`,
        });
      }
    }
  }

  const out: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];
  const flushList = () => {
    if (listTag && listItems.length) {
      out.push(`<${listTag}>${listItems.map((it) => `<li>${it}</li>`).join('')}</${listTag}>`);
    }
    listTag = null;
    listItems = [];
  };
  for (const seg of segments) {
    if (seg.kind === 'ul' || seg.kind === 'ol') {
      if (listTag !== seg.kind) flushList();
      listTag = seg.kind;
      listItems.push(seg.html);
    } else {
      flushList();
      out.push(`<p>${seg.html}</p>`);
    }
  }
  flushList();
  return out.join('');
}
