import {
  ChangeDetectionStrategy,
  Component,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';

import {
  PrimaryIntelligenceBrief,
  PrimaryIntelligenceLink,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { resolveAuthorName } from '../../utils/intelligence-authors';
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';

/**
 * Collapsed, expandable list of non-lead intelligence entries (briefs) for
 * a detail page. One row per brief: headline, author byline, updated date,
 * and an optional vN version chip. Clicking a row expands it in place to
 * reveal summary, implications, and linked entities.
 *
 * When canManage is true (agency view), each row also exposes:
 *   - A "Pin as lead entry" icon button (emits pin with the anchor_id).
 *   - A drag handle for reordering (emits reorderTo with the new anchor_id order).
 *   - An "Edit entry" icon button (emits open with the anchor_id).
 *
 * No service calls: all data is passed in via inputs so the component stays
 * purely presentational.
 */
@Component({
  selector: 'app-intelligence-brief-list',
  imports: [ButtonModule, RouterLink, Tooltip, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './intelligence-brief-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceBriefListComponent {
  readonly briefs = input<PrimaryIntelligenceBrief[]>([]);
  readonly canManage = input<boolean>(false);
  /** Map of user_id -> display name for byline resolution. */
  readonly authorMap = input<Record<string, string>>({});
  /** Required to build clickable entity links in the expanded body. */
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

  /** Emitted when the agency user activates Edit for a brief. Carries anchor_id. */
  readonly open = output<string>();
  /** Emitted when the agency user pins a brief as the lead entry. Carries anchor_id. */
  readonly pin = output<string>();
  /** Emitted after a drag-reorder. Carries the full ordered anchor_id array. */
  readonly reorderTo = output<string[]>();
  /** Emitted when the user activates Version history for a brief. Carries anchor_id. */
  readonly viewHistory = output<string>();

  /** Which anchor_ids are currently expanded. */
  protected readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  /**
   * Local mutable copy of briefs for optimistic drag-drop reordering.
   * linkedSignal resets to the latest briefs input whenever it changes
   * (e.g. after the parent commits the new order to the server).
   */
  protected readonly orderedBriefs = linkedSignal(() => [...this.briefs()]);

  protected isExpanded(anchorId: string): boolean {
    return this.expandedIds().has(anchorId);
  }

  protected toggleExpand(anchorId: string): void {
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (next.has(anchorId)) {
        next.delete(anchorId);
      } else {
        next.add(anchorId);
      }
      return next;
    });
  }

  protected onDrop(event: CdkDragDrop<PrimaryIntelligenceBrief[]>): void {
    const items = [...this.orderedBriefs()];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    this.orderedBriefs.set(items);
    this.reorderTo.emit(items.map((b) => b.anchor_id));
  }

  protected onPinClick(anchorId: string): void {
    this.pin.emit(anchorId);
  }

  protected onOpenClick(anchorId: string): void {
    this.open.emit(anchorId);
  }

  protected onViewHistoryClick(anchorId: string): void {
    this.viewHistory.emit(anchorId);
  }

  /**
   * Headline to display in the collapsed row. Prefers the published record,
   * falling back to the draft when no published payload exists.
   */
  protected headlineFor(brief: PrimaryIntelligenceBrief): string {
    const r = (brief.published ?? brief.draft)?.record ?? null;
    return r?.headline ?? '';
  }

  /**
   * Author byline: the display name of the last editor, resolved from the
   * payload's authors map merged with the parent-supplied authorMap override.
   */
  protected bylineFor(brief: PrimaryIntelligenceBrief): string {
    const payload = brief.published ?? brief.draft ?? null;
    if (!payload) return '';
    return resolveAuthorName(payload.record.last_edited_by, payload.authors, this.authorMap());
  }

  /** Updated date, pre-formatted for the byline row. */
  protected updatedFor(brief: PrimaryIntelligenceBrief): string {
    return formatDate(brief.updated_at);
  }

  protected summaryHtmlFor(brief: PrimaryIntelligenceBrief): string {
    const md = (brief.published ?? brief.draft)?.record.summary_md ?? '';
    return renderMarkdownInline(md);
  }

  protected implicationsHtmlFor(brief: PrimaryIntelligenceBrief): string {
    const md = (brief.published ?? brief.draft)?.record.implications_md ?? '';
    return renderMarkdownInline(md);
  }

  protected linkedGroupsFor(
    brief: PrimaryIntelligenceBrief
  ): { relationship: string; items: PrimaryIntelligenceLink[] }[] {
    const links = (brief.published ?? brief.draft)?.links ?? [];
    const groups = new Map<string, PrimaryIntelligenceLink[]>();
    for (const l of links) {
      const key = l.relationship_type || 'Linked';
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([relationship, items]) => ({
      relationship,
      items,
    }));
  }

  protected linkLabelFor(link: PrimaryIntelligenceLink): string {
    return link.entity_name?.trim()
      ? link.entity_name
      : `${link.entity_type} ${link.entity_id.slice(0, 8)}`;
  }

  protected linkRouteFor(
    link: PrimaryIntelligenceLink
  ): { commands: unknown[]; queryParams?: Record<string, string> } | null {
    const commands = buildEntityRouterLink(
      this.tenantId(),
      this.spaceId(),
      link.entity_type,
      link.entity_id
    );
    return commands ? { commands } : null;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
