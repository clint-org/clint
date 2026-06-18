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
import { resolveAuthorName, resolveContributorLine } from '../../utils/intelligence-authors';

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

  protected readonly summaryHtml = computed(() =>
    renderMarkdownInline(this.current()?.record.summary_md ?? '')
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

  /** Updated date, pre-formatted, for the byline row. */
  protected readonly updatedLabel = computed(() => {
    const c = this.current();
    return c ? formatDate(c.record.updated_at) : '';
  });

  /**
   * The lead name shown beside the avatar tile in the byline. For clients it
   * is the agency; for agency members it is the person who last edited the read.
   */
  protected readonly bylineLeadName = computed(() => {
    const c = this.current();
    if (!c) return '';
    if (this.agencyView()) {
      const override = this.authorMap();
      return resolveAuthorName(c.record.last_edited_by, c.authors, override) || this.agencyName();
    }
    return this.agencyName();
  });

  /** First character of the lead name, used for the avatar tile. */
  protected readonly bylineInitial = computed(() => {
    const name = this.bylineLeadName().trim();
    return name ? name.charAt(0).toUpperCase() : '?';
  });

  /**
   * Contributor line for the agency-internal view only. Shown as a quiet
   * secondary line under the lead byline when there is more than one
   * contributor, so the redesign keeps the credit without the loud mono row.
   */
  protected readonly contributorLine = computed<string | null>(() => {
    if (!this.agencyView()) return null;
    const c = this.current();
    if (!c) return null;
    const override = this.authorMap();
    const line = resolveContributorLine(c.contributors, c.authors, override);
    if (!line || line === '--') return null;
    return line;
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

