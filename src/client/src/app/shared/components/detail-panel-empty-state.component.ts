import { Component, input } from '@angular/core';

/**
 * Empty-state primitive for detail panes. Renders the action prompt eyebrow
 * ("Click a catalyst to see details") and projects the rest of the body so
 * each surface composes its own count summary, histogram section, and
 * recent-activity section using <app-detail-panel-section> + entity rows.
 *
 * Caller is responsible for picking the right shell mode: a muted-tone
 * shell label like "Catalysts · overview" goes in the shell's `label`,
 * not here.
 */
@Component({
  selector: 'app-detail-panel-empty-state',
  standalone: true,
  template: `
    <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {{ prompt() }}
    </p>
    <ng-content />
  `,
})
export class DetailPanelEmptyStateComponent {
  readonly prompt = input.required<string>();
}
