import { Component, input } from '@angular/core';

/**
 * Layout shell for non-timeline management pages: Companies, Products,
 * Marker Types, Therapeutic Areas, Trials, Tenant Settings, etc.
 *
 * Provides:
 *  - Full-bleed container (no max-width cap — density over decoration).
 *  - Eyebrow / section label (uppercase tracked slate-400).
 *  - Tracked title with an optional record-count pill.
 *  - Optional subtitle.
 *  - Right-aligned action slot via `<div actions>` content projection.
 *  - Content slot for the table (or whatever).
 *
 * Styling lives in shared/styles/manage-table.css as `.manage-shell*`.
 *
 * Usage:
 *   <app-manage-page-shell
 *     eyebrow="Manage"
 *     title="Products"
 *     [count]="products().length"
 *     subtitle="All drug programs tracked in this space">
 *     <div actions>
 *       <p-button label="Add product" ... />
 *     </div>
 *     <p-table styleClass="manage-table" ... />
 *   </app-manage-page-shell>
 */
@Component({
  selector: 'app-manage-page-shell',
  standalone: true,
  template: `
    <div class="manage-shell" [class.manage-shell--narrow]="narrow()">
      <div class="manage-shell__eyebrow">{{ eyebrow() }}</div>
      <div class="manage-shell__title-row">
        <div>
          <h1 class="manage-shell__title">
            <span>{{ title() }}</span>
            @if (count() !== null) {
              <span class="manage-shell__count">{{ count() }}</span>
            }
          </h1>
          @if (subtitle()) {
            <p class="manage-shell__subtitle">{{ subtitle() }}</p>
          }
        </div>
        <div class="manage-shell__actions">
          <ng-content select="[actions]" />
        </div>
      </div>
      <ng-content />
    </div>
  `,
})
export class ManagePageShellComponent {
  readonly eyebrow = input<string>('Manage');
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly count = input<number | null>(null);
  /** Cap the shell to a narrower width for form-heavy detail pages. */
  readonly narrow = input<boolean>(false);
}
