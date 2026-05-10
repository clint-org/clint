import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import {
  IntelligenceHistoryPayload,
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

  protected readonly expanded = signal(false);

  protected readonly versions = computed<IntelligenceVersionRow[]>(
    () => this.payload().versions ?? [],
  );
  protected readonly versionCount = computed(() => this.versions().length);
  protected readonly latest = computed<IntelligenceVersionRow | null>(
    () => this.versions()[0] ?? null,
  );
  protected readonly canExpand = computed(() => this.versionCount() > 1);

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
