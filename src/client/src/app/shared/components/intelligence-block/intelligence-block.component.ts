import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';

import { BrandContextService } from '../../../core/services/brand-context.service';
import {
  IntelligencePayload,
  PrimaryIntelligenceLink,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';

/**
 * Display-only presenter for a primary intelligence read. Shows the
 * agency-internal byline (initials + change_note) when `agencyView` is
 * true, otherwise the client-facing agency-only byline. Hosts pass an
 * `edit` output if they want to surface the edit affordance.
 */
@Component({
  selector: 'app-intelligence-block',
  standalone: true,
  imports: [ButtonModule, RouterLink, Tooltip],
  templateUrl: './intelligence-block.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceBlockComponent {
  private readonly brand = inject(BrandContextService);

  readonly published = input<IntelligencePayload | null>(null);
  readonly draft = input<IntelligencePayload | null>(null);
  readonly agencyView = input<boolean>(false);
  /** Map of user id -> initials for agency-internal byline. */
  readonly authorMap = input<Record<string, string>>({});
  /** Tenant + space ids used to build clickable links to linked entities. */
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

  readonly edit = output<void>();
  readonly discardDraft = output<void>();
  readonly withdraw = output<void>();
  readonly purge = output<void>();
  readonly purgeAnchor = output<void>();

  protected readonly current = computed<IntelligencePayload | null>(() => {
    return this.published() ?? this.draft() ?? null;
  });

  protected readonly primaryDestructiveAction = computed<'discard' | 'withdraw' | null>(() => {
    const c = this.current()?.record;
    if (!c) return null;
    if (c.state === 'draft') return 'discard';
    if (c.state === 'published') return 'withdraw';
    return null;
  });

  /**
   * True when both a published row AND an in-flight draft exist for this
   * anchor. Agency authors save drafts via auto-save without publishing; the
   * block keeps showing the published content (clients should never see
   * unpublished writes), so without an explicit affordance an agency user
   * can't tell their changes were saved.
   */
  protected readonly draftPending = computed<boolean>(() => {
    return !!this.published() && !!this.draft();
  });

  protected readonly thesisHtml = computed(() =>
    renderMarkdownInline(this.current()?.record.thesis_md ?? '')
  );

  protected readonly watchHtml = computed(() =>
    renderMarkdownInline(this.current()?.record.watch_md ?? '')
  );

  protected readonly implicationsHtml = computed(() =>
    renderMarkdownInline(this.current()?.record.implications_md ?? '')
  );

  protected readonly agencyName = computed(() => {
    const b = this.brand.brand();
    if (b.kind === 'tenant') return b.agency?.name ?? b.app_display_name;
    return b.app_display_name;
  });

  protected readonly statePillText = computed(() => {
    const c = this.current();
    if (!c) return '';
    return c.record.state === 'draft' ? 'Draft' : 'Published';
  });

  protected readonly clientByline = computed(() => {
    const c = this.current();
    if (!c) return '';
    const updated = formatDate(c.record.updated_at);
    return `Published by ${this.agencyName()}, updated ${updated}`;
  });

  protected readonly agencyByline = computed(() => {
    const c = this.current();
    if (!c) return '';
    const updated = formatDate(c.record.updated_at);
    const map = this.authorMap();
    const initials = (c.contributors ?? [])
      .map((id) => map[id] ?? initialsFromId(id))
      .filter((s) => !!s);
    const contributors = initials.length ? initials.join(', ') : '--';
    const publisher = map[c.record.last_edited_by] ?? initialsFromId(c.record.last_edited_by);
    return `Contributors: ${contributors} -- updated ${updated} by ${publisher}`;
  });

  protected readonly publishNote = computed<string | null>(() => {
    const note = this.current()?.record.publish_note ?? null;
    return note && note.trim() ? note : null;
  });

  protected readonly linkedGroups = computed(() => {
    const links = this.current()?.links ?? [];
    const groups = new Map<string, PrimaryIntelligenceLink[]>();
    for (const l of links) {
      const key = l.relationship_type || 'Linked';
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([relationship, items]) => ({ relationship, items }));
  });

  protected linkLabel(link: PrimaryIntelligenceLink): string {
    return link.entity_name?.trim()
      ? link.entity_name
      : `${link.entity_type} ${link.entity_id.slice(0, 8)}`;
  }

  /**
   * Routes a linked-entity chip to the matching detail page. IntelligenceLinkEntityType
   * excludes 'space', so engagement is not a link target here. Returns null when
   * tenantId/spaceId are missing so the template renders a non-anchor span.
   */
  protected linkRoute(link: PrimaryIntelligenceLink): {
    commands: unknown[];
    queryParams?: Record<string, string>;
  } | null {
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

function initialsFromId(id: string): string {
  return id.slice(0, 2).toUpperCase();
}
