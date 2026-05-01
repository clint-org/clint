import { Component, input } from '@angular/core';

/**
 * Recent materials section. Phase 1 hides this entirely (the materials
 * registry has not shipped). The component is scaffolded so phase 2 can
 * wire `list_materials` without further frontend churn. Caller controls
 * visibility via the `visible` input; default false keeps the slot off the
 * page.
 *
 * See docs/specs/engagement-landing/spec.md (open question on "hide
 * entirely until materials registry ships, or render an empty-state with
 * 'Coming soon'? Probably hide.").
 */
@Component({
  selector: 'app-recent-materials-widget',
  standalone: true,
  template: `
    @if (visible()) {
      <section class="materials-section" aria-labelledby="materials-heading">
        <header class="sect-head">
          <h2 id="materials-heading">Recent materials</h2>
          <span class="meta">Decks and docs registered against this engagement</span>
        </header>
        <p class="empty">No materials registered yet.</p>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .materials-section {
        background: transparent;
      }
      .sect-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        padding: 0 0 10px 0;
        border-bottom: 1px solid #e2e8f0;
        margin-bottom: 14px;
        gap: 12px;
      }
      .sect-head h2 {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 11px;
        font-weight: 700;
        color: #334155;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin: 0;
      }
      .meta {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        color: #94a3b8;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .empty {
        margin: 0;
        font-size: 12px;
        color: #64748b;
      }
    `,
  ],
})
export class RecentMaterialsWidgetComponent {
  /** Render the section only when materials registry is shipped. Defaults
   * to false so phase 1 leaves the slot off the page entirely. */
  readonly visible = input<boolean>(false);
}
