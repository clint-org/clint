import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { Menu } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { Tooltip } from 'primeng/tooltip';

import {
  IntelligenceHistoryPayload,
  PrimaryIntelligenceBrief,
  PrimaryIntelligenceLink,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { resolveAuthorName } from '../../utils/intelligence-authors';
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';
import { IntelligenceHistoryPanelComponent } from '../intelligence-history-panel/intelligence-history-panel.component';
import { computeReorder, leadFirst } from './reorder';

/**
 * Unified vertical stack of intelligence briefs for an entity detail page.
 * The lead brief is the first card (badged, expanded by default, drag-locked);
 * the rest collapse and expand in place. Each card owns its version history,
 * rendered inline via the existing history panel and lazily requested on first
 * open. Purely presentational: all data arrives via inputs, all actions emit.
 */
@Component({
  selector: 'app-intelligence-stack',
  imports: [
    ButtonModule,
    Menu,
    Tooltip,
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    IntelligenceHistoryPanelComponent,
  ],
  templateUrl: './intelligence-stack.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceStackComponent {
  readonly briefs = input<PrimaryIntelligenceBrief[]>([]);
  readonly canManage = input<boolean>(false);
  readonly canPurge = input<boolean>(false);
  readonly authorMap = input<Record<string, string>>({});
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);
  readonly histories = input<Record<string, IntelligenceHistoryPayload>>({});

  readonly edit = output<string>();
  readonly pin = output<string>();
  readonly reorderTo = output<string[]>();
  readonly requestHistory = output<string>();
  readonly withdraw = output<{ anchorId: string; id: string; headline: string }>();
  readonly purgeVersion = output<{ id: string; confirmation: string }>();
  readonly purgeEntry = output<{ id: string; confirmation: string }>();
  readonly discardDraft = output<string>();

  /** Local mutable copy for optimistic drag reorder; resets on new input. */
  protected readonly ordered = linkedSignal(() => leadFirst(this.briefs()));

  /** Which cards are expanded. Lead (index 0) is expanded by default. */
  protected readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  /** Cards whose history has already been requested (lazy-load guard). */
  private readonly requestedHistoryIds = new Set<string>();

  protected readonly leadAnchorId = computed<string | null>(
    () => this.ordered().find((b) => b.is_lead)?.anchor_id ?? this.ordered()[0]?.anchor_id ?? null,
  );

  /** Anchors the user has explicitly toggled (so default-open can be undone). */
  private readonly touchedIds = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      const id = this.leadAnchorId();
      if (id) this.ensureHistory(id);
    });
  }

  protected isLead(brief: PrimaryIntelligenceBrief): boolean {
    return brief.anchor_id === this.leadAnchorId();
  }

  protected isExpanded(anchorId: string): boolean {
    // The lead is open by default until the user explicitly collapses it.
    if (anchorId === this.leadAnchorId() && !this.touchedIds().has(anchorId)) return true;
    return this.expandedIds().has(anchorId);
  }

  protected toggleExpand(anchorId: string): void {
    const currentlyExpanded = this.isExpanded(anchorId);
    this.touchedIds.update((s) => new Set(s).add(anchorId));
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (currentlyExpanded) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
    if (!currentlyExpanded) this.ensureHistory(anchorId);
  }

  private ensureHistory(anchorId: string): void {
    if (this.requestedHistoryIds.has(anchorId)) return;
    this.requestedHistoryIds.add(anchorId);
    this.requestHistory.emit(anchorId);
  }

  protected onDrop(event: CdkDragDrop<PrimaryIntelligenceBrief[]>): void {
    const ids = computeReorder(this.ordered(), event.previousIndex, event.currentIndex);
    const byId = new Map(this.ordered().map((b) => [b.anchor_id, b]));
    this.ordered.set(ids.map((id) => byId.get(id)!).filter(Boolean));
    this.reorderTo.emit(ids);
  }

  protected canPinBrief(brief: PrimaryIntelligenceBrief): boolean {
    return !this.isLead(brief) && !!brief.published;
  }

  protected onPinClick(anchorId: string): void {
    this.pin.emit(anchorId);
  }

  protected onEditClick(anchorId: string): void {
    this.edit.emit(anchorId);
  }

  /** Build the overflow menu for one brief. */
  protected menuFor(brief: PrimaryIntelligenceBrief): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Edit entry', command: () => this.edit.emit(brief.anchor_id) },
    ];
    const published = brief.published?.record;
    if (published) {
      items.push({
        label: 'Withdraw',
        command: () =>
          this.withdraw.emit({
            anchorId: brief.anchor_id,
            id: published.id,
            headline: published.headline,
          }),
      });
    }
    if (this.canPurge() && published) {
      items.push({ separator: true });
      items.push({
        label: 'Purge entry',
        styleClass: 'text-red-700',
        command: () => this.purgeEntry.emit({ id: published.id, confirmation: published.headline }),
      });
    }
    return items;
  }

  protected headlineFor(brief: PrimaryIntelligenceBrief): string {
    return (brief.published ?? brief.draft)?.record.headline ?? '';
  }

  protected bylineFor(brief: PrimaryIntelligenceBrief): string {
    const payload = brief.published ?? brief.draft ?? null;
    if (!payload) return '';
    return resolveAuthorName(payload.record.last_edited_by, payload.authors, this.authorMap());
  }

  protected updatedFor(brief: PrimaryIntelligenceBrief): string {
    return formatDate(brief.updated_at);
  }

  protected draftPendingFor(brief: PrimaryIntelligenceBrief): boolean {
    return !!brief.published && !!brief.draft;
  }

  protected summaryHtmlFor(brief: PrimaryIntelligenceBrief): string {
    return renderMarkdownInline((brief.published ?? brief.draft)?.record.summary_md ?? '');
  }

  protected implicationsHtmlFor(brief: PrimaryIntelligenceBrief): string {
    return renderMarkdownInline((brief.published ?? brief.draft)?.record.implications_md ?? '');
  }

  protected linkedGroupsFor(
    brief: PrimaryIntelligenceBrief,
  ): { relationship: string; items: PrimaryIntelligenceLink[] }[] {
    const links = (brief.published ?? brief.draft)?.links ?? [];
    const groups = new Map<string, PrimaryIntelligenceLink[]>();
    for (const l of links) {
      const key = l.relationship_type || 'Linked';
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([relationship, items]) => ({ relationship, items }));
  }

  protected linkLabelFor(link: PrimaryIntelligenceLink): string {
    return link.entity_name?.trim()
      ? link.entity_name
      : `${link.entity_type} ${link.entity_id.slice(0, 8)}`;
  }

  protected linkRouteFor(
    link: PrimaryIntelligenceLink,
  ): { commands: unknown[]; queryParams?: Record<string, string> } | null {
    const commands = buildEntityRouterLink(
      this.tenantId(),
      this.spaceId(),
      link.entity_type,
      link.entity_id,
    );
    return commands ? { commands } : null;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
