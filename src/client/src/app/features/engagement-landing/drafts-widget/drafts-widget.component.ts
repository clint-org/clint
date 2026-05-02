import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

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
        <h2 id="drafts-heading">Your drafts</h2>
        <span class="agency-tag" aria-label="Visible to agency members only">Agency only</span>
      </header>
      @if (drafts().length === 0) {
        <div class="empty">
          <p class="empty-line">No drafts yet.</p>
          <p class="empty-hint">
            Drafts of primary intelligence by your agency will appear here once an analyst starts
            one.
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
                <span aria-hidden="true" class="dot">.</span>
                <span class="draft-stamp">{{ formatStamp(draft.updated_at) }}</span>
              </p>
            </li>
          }
        </ul>
        @if (allDraftsRoute()) {
          <a
            [routerLink]="allDraftsRoute()"
            [queryParams]="{ status: 'drafts' }"
            class="section-action-link drafts-all-link"
          >
            All drafts
          </a>
        }
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .card {
        background: white;
        border: 1px solid #e2e8f0;
        border-left: 3px solid #f59e0b;
        padding: 16px 18px;
      }
      .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid #f1f5f9;
        margin-bottom: 12px;
      }
      .card-head h2 {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10.5px;
        font-weight: 700;
        color: #334155;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin: 0;
      }
      .agency-tag {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 8.5px;
        font-weight: 700;
        color: #d97706;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        padding: 2px 6px;
        background: #fef3c7;
      }
      .empty {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 6px 0 4px;
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
        gap: 10px;
      }
      .draft-row {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .draft-headline {
        font-size: 12.5px;
        font-weight: 600;
        color: #0f172a;
        text-decoration: none;
        line-height: 1.35;
      }
      .draft-headline:hover {
        color: var(--brand-700);
      }
      .draft-meta {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        color: #94a3b8;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dot {
        font-size: 10px;
        line-height: 1;
        opacity: 0.6;
      }
      .drafts-all-link {
        margin-top: 12px;
        display: inline-block;
      }
    `,
  ],
})
export class DraftsWidgetComponent {
  readonly drafts = input<IntelligenceFeedRow[]>([]);
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

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
