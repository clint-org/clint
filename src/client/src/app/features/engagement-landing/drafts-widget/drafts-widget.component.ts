import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BrandContextService } from '../../../core/services/brand-context.service';
import {
  ENTITY_TYPE_LABEL,
  IntelligenceFeedRow,
} from '../../../core/models/primary-intelligence.model';

/**
 * Side rail "Your drafts" widget. Renders up to a few in-progress drafts
 * authored by anyone in the viewer's agency on this engagement. The parent
 * `EngagementLandingComponent` hides this widget entirely for non-agency
 * viewers; this component does not check the role itself.
 */
@Component({
  selector: 'app-drafts-widget',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="card" aria-labelledby="drafts-heading">
      <header class="card-head">
        <h2 id="drafts-heading">
          Your drafts
          <span class="agency-tag" aria-label="Visible to agency members only">Agency only</span>
        </h2>
        @if (drafts().length > 0 && allDraftsRoute()) {
          <a
            [routerLink]="allDraftsRoute()"
            [queryParams]="{ status: 'drafts' }"
            class="card-action"
            >All drafts →</a
          >
        }
      </header>
      @if (drafts().length === 0) {
        <div class="empty">
          <p class="empty-line">No drafts yet.</p>
          <p class="empty-hint">
            Drafts of primary intelligence by your agency will appear here once
            {{ starterLabel() }} starts one.
          </p>
        </div>
      } @else {
        <ul class="drafts-list">
          @for (draft of drafts(); track draft.id) {
            <li class="draft-row">
              <a
                [routerLink]="draftRoute(draft)"
                [queryParams]="draftQueryParams(draft)"
                class="draft-headline"
                >{{ draft.headline }}</a
              >
              <p class="draft-meta">
                <span class="draft-entity">{{ entityLabel(draft) }}</span>
                <span aria-hidden="true" class="dot">·</span>
                <span class="draft-stamp">{{ formatStamp(draft.updated_at) }}</span>
              </p>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: flex;
      }
      .card {
        background: white;
        border: 1px solid #e2e8f0;
        border-left: 3px solid #f59e0b;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
      }
      .card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid #f1f5f9;
        background: #f8fafc;
      }
      .card-head h2 {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        font-weight: 600;
        color: #334155;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        margin: 0;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .agency-tag {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 9px;
        font-weight: 700;
        color: #92400e;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 1px 6px;
        background: #fef3c7;
      }
      .card-action {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--brand-600, #0d9488);
        text-decoration: none;
      }
      .card-action:hover,
      .card-action:focus-visible {
        color: var(--brand-700, #0f766e);
      }
      .empty {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 14px;
      }
      .empty-line {
        margin: 0;
        font-size: 12.5px;
        font-weight: 600;
        color: #0f172a;
      }
      .empty-hint {
        margin: 0;
        font-size: 12px;
        color: #64748b;
        line-height: 1.5;
      }
      .drafts-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .draft-row {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 10px 14px;
        border-bottom: 1px solid #f1f5f9;
      }
      .draft-row:last-child {
        border-bottom: 0;
      }
      .draft-headline {
        font-size: 12.5px;
        font-weight: 500;
        color: #0f172a;
        text-decoration: none;
        line-height: 1.35;
        letter-spacing: -0.005em;
      }
      .draft-headline:hover {
        color: var(--brand-700);
      }
      .draft-meta {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 9.5px;
        color: #94a3b8;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .draft-entity {
        color: #475569;
        font-weight: 600;
      }
      .dot {
        font-size: 10px;
        line-height: 1;
        opacity: 0.6;
      }
    `,
  ],
})
export class DraftsWidgetComponent {
  private readonly brand = inject(BrandContextService);

  readonly drafts = input<IntelligenceFeedRow[]>([]);
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

  // "...once {starter} starts one." With an agency: "a {agency} teammate";
  // without (default brand or direct tenant): keep the generic "an analyst".
  protected readonly starterLabel = computed(() => {
    const name = this.brand.agency()?.name;
    return name ? `a ${name} teammate` : 'an analyst';
  });

  protected readonly allDraftsRoute = computed(() => {
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return '';
    return `/t/${t}/s/${s}/intelligence`;
  });

  protected entityLabel(draft: IntelligenceFeedRow): string {
    return ENTITY_TYPE_LABEL[draft.entity_type] ?? draft.entity_type;
  }

  protected draftRoute(draft: IntelligenceFeedRow): unknown[] {
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return [];
    if (draft.entity_type === 'trial') {
      return ['/t', t, 's', s, 'manage', 'trials', draft.entity_id];
    }
    return ['/t', t, 's', s, 'intelligence'];
  }

  protected draftQueryParams(draft: IntelligenceFeedRow): Record<string, string> | null {
    return draft.entity_type === 'trial' ? null : { status: 'drafts' };
  }

  protected formatStamp(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
