import { Component, computed, input } from '@angular/core';

import { CtgovMarkerMetadata } from '../../core/models/catalyst.model';

/**
 * Small slate badge that signals "this marker (or row) was auto-derived
 * from clinicaltrials.gov sync". Renders only when the metadata payload
 * has source === 'ctgov'; otherwise the component is invisible (no DOM)
 * so callers can drop it next to a title unconditionally.
 *
 * Two visual modes:
 *   compact (default) -- 'CT.gov' chip, fits inline next to a marker title
 *   detailed          -- 'Synced from CT.gov' pill, used in the marker
 *                        detail panel header where there is more space
 */
@Component({
  selector: 'app-ctgov-source-tag',
  standalone: true,
  template: `
    @if (isCtgov()) {
      <span
        class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-wider text-slate-500"
        [attr.title]="tooltip()"
        [attr.aria-label]="tooltip()"
      >
        <span class="h-1 w-1 rounded-full bg-slate-400"></span>
        @if (variant() === 'detailed') {
          Synced from CT.gov
        } @else {
          CT.gov
        }
      </span>
    }
  `,
})
export class CtgovSourceTagComponent {
  readonly metadata = input<Record<string, unknown> | null>(null);
  readonly variant = input<'compact' | 'detailed'>('compact');

  protected readonly isCtgov = computed(() => {
    const m = this.metadata();
    return !!m && (m as Partial<CtgovMarkerMetadata>).source === 'ctgov';
  });

  protected readonly tooltip = computed(
    () =>
      'Auto-derived from clinicaltrials.gov sync. Click the marker to see source field and last sync time.'
  );
}
