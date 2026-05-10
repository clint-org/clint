import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { diffWords } from 'diff';

import {
  IntelligenceHistoryPayload,
  IntelligenceVersionRevision,
  IntelligenceVersionRow,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { summarizeVersionChange, VersionSection } from '../../utils/version-summary';

/**
 * Inline panel mounted below IntelligenceBlock on every entity detail
 * page. Shows version history for the anchor. Collapsed by default;
 * lazy expands on click. Agency-only affordances (drafts subsection,
 * per-version edit diffs, withdraw / purge) are gated by
 * `currentUserCanEdit`.
 */
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
  readonly versionRevisionsRequested = output<string>();
  readonly draftClicked = output<void>();

  protected readonly expanded = signal(false);

  protected readonly versions = computed<IntelligenceVersionRow[]>(
    () => this.payload().versions ?? [],
  );
  protected readonly versionCount = computed(() => this.versions().length);
  protected readonly latest = computed<IntelligenceVersionRow | null>(
    () => this.versions()[0] ?? null,
  );
  protected readonly canExpand = computed(() => this.versionCount() > 1);

  protected readonly draft = computed(() => this.payload().draft);
  protected readonly current = computed(() => this.payload().current);

  protected readonly draftSummary = computed(() => {
    const d = this.draft();
    const c = this.current();
    if (!d) return null;
    if (!c) {
      return { isFirst: true, changedSections: [] as VersionSection[] };
    }
    return summarizeVersionChange(
      {
        headline: d.headline,
        thesis_md: d.thesis_md,
        watch_md: d.watch_md,
        implications_md: d.implications_md,
      },
      {
        headline: c.headline,
        thesis_md: c.thesis_md,
        watch_md: c.watch_md,
        implications_md: c.implications_md,
      },
    );
  });

  protected readonly expandedVersionIds = signal<ReadonlySet<string>>(new Set());

  protected isVersionExpanded(id: string): boolean {
    return this.expandedVersionIds().has(id);
  }

  protected toggleVersion(id: string): void {
    this.expandedVersionIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected priorOf(version: IntelligenceVersionRow): IntelligenceVersionRow | null {
    const all = this.versions();
    const idx = all.findIndex((v) => v.id === version.id);
    if (idx === -1 || idx === all.length - 1) return null;
    return all[idx + 1];
  }

  protected summaryFor(version: IntelligenceVersionRow): {
    changedSections: VersionSection[];
    isFirst: boolean;
  } {
    return summarizeVersionChange(version, this.priorOf(version));
  }

  private static readonly SECTION_LABEL: Record<VersionSection, string> = {
    headline: 'Headline',
    thesis: 'Thesis',
    watch: 'What to watch',
    implications: 'Implications',
  };

  protected sectionLabel(section: VersionSection): string {
    return IntelligenceHistoryPanelComponent.SECTION_LABEL[section];
  }

  protected renderInline(md: string): string {
    return renderMarkdownInline(md ?? '');
  }

  protected authorInitials(id: string): string {
    return this.authorMap()[id] ?? id.slice(0, 2).toUpperCase();
  }

  protected readonly versionRevisions = signal<Record<string, IntelligenceVersionRevision[]>>({});
  protected readonly diffShownIds = signal<ReadonlySet<string>>(new Set());

  protected isDiffShown(id: string): boolean {
    return this.diffShownIds().has(id);
  }

  protected toggleDiff(id: string): void {
    const has = this.diffShownIds().has(id);
    if (!has && !(id in this.versionRevisions())) {
      this.versionRevisionsRequested.emit(id);
    }
    this.diffShownIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  setVersionRevisions(versionId: string, revs: IntelligenceVersionRevision[]): void {
    this.versionRevisions.update((prev) => ({ ...prev, [versionId]: revs }));
  }

  protected diffPairsFor(versionId: string): {
    fromAt: string;
    toAt: string;
    changeNote: string | null;
    fields: { section: VersionSection; html: string }[];
  }[] {
    const revs = this.versionRevisions()[versionId] ?? [];
    const pairs: {
      fromAt: string;
      toAt: string;
      changeNote: string | null;
      fields: { section: VersionSection; html: string }[];
    }[] = [];
    for (let i = 1; i < revs.length; i++) {
      const prev = revs[i - 1];
      const curr = revs[i];
      const fields: { section: VersionSection; html: string }[] = [];
      for (const [section, key] of [
        ['headline', 'headline'],
        ['thesis', 'thesis_md'],
        ['watch', 'watch_md'],
        ['implications', 'implications_md'],
      ] as [VersionSection, keyof IntelligenceVersionRevision][]) {
        const before = (prev[key] as string) ?? '';
        const after = (curr[key] as string) ?? '';
        if (before !== after) {
          fields.push({ section, html: this.renderWordDiff(before, after) });
        }
      }
      pairs.push({
        fromAt: prev.edited_at,
        toAt: curr.edited_at,
        changeNote: curr.change_note,
        fields,
      });
    }
    return pairs;
  }

  private renderWordDiff(before: string, after: string): string {
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

  protected toggle(): void {
    if (!this.canExpand()) return;
    this.expanded.update((v) => !v);
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
