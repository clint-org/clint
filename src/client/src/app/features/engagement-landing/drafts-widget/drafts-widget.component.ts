import { Component } from '@angular/core';

/**
 * Side rail "Your drafts" widget. Phase 1 placeholder: the primary
 * intelligence table is not shipped yet, so we render an empty state and
 * keep the placement so existing users see the slot for when the data
 * source ships in phase 2.
 *
 * The parent `EngagementLandingComponent` is responsible for hiding this
 * widget entirely for non-agency viewers; this component does not check
 * the role itself.
 */
@Component({
  selector: 'app-drafts-widget',
  standalone: true,
  template: `
    <section class="card" aria-labelledby="drafts-heading">
      <header class="card-head">
        <h2 id="drafts-heading">Your drafts</h2>
        <span class="agency-tag" aria-label="Visible to agency members only">Agency only</span>
      </header>
      <div class="empty">
        <p class="empty-line">No drafts yet.</p>
        <p class="empty-hint">
          Drafts of primary intelligence by your agency will appear here once an analyst starts
          one.
        </p>
      </div>
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
    `,
  ],
})
export class DraftsWidgetComponent {}
