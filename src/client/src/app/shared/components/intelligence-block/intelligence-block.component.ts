import { Component, computed, inject, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { BrandContextService } from '../../../core/services/brand-context.service';
import {
  IntelligencePayload,
  PrimaryIntelligenceLink,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';

/**
 * Display-only presenter for a primary intelligence read. Shows the
 * agency-internal byline (initials + change_note) when `agencyView` is
 * true, otherwise the client-facing agency-only byline. Hosts pass an
 * `edit` output if they want to surface the edit affordance.
 */
@Component({
  selector: 'app-intelligence-block',
  standalone: true,
  imports: [ButtonModule],
  templateUrl: './intelligence-block.component.html',
})
export class IntelligenceBlockComponent {
  private readonly brand = inject(BrandContextService);

  readonly published = input<IntelligencePayload | null>(null);
  readonly draft = input<IntelligencePayload | null>(null);
  readonly agencyView = input<boolean>(false);
  /** Map of user id -> initials for agency-internal byline. */
  readonly authorMap = input<Record<string, string>>({});

  readonly edit = output<void>();

  protected readonly current = computed<IntelligencePayload | null>(() => {
    return this.published() ?? this.draft() ?? null;
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

  protected readonly latestRevisionNote = computed<string | null>(() => {
    const c = this.current();
    if (!c) return null;
    const latest = (c.recent_revisions ?? [])[0];
    return latest?.change_note ?? null;
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
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function initialsFromId(id: string): string {
  return id.slice(0, 2).toUpperCase();
}
