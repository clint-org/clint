import { Component, input } from '@angular/core';

import { PHASE_COLOR, RING_DEV_RANK, RingPhase } from '../../core/models/landscape.model';
import { DetailPanelMiniPhaseBarComponent } from './detail-panel-mini-phase-bar.component';

export interface PhaseRaceEntry {
  id: string;
  name: string;
  /** Subtitle (typically the company name) shown beneath the product name. */
  subtitle: string;
  phase: RingPhase;
}

const PHASE_DISPLAY: Partial<Record<RingPhase, string>> = {
  PRECLIN: 'Pre',
  APPROVED: 'App',
  LAUNCHED: 'L',
};

/**
 * Visual race comparison used in the positioning detail pane. Each row is a
 * product with a 7-segment mini phase bar (variant B from the mockup:
 * two-line label, multi-color bar). Sorted by phase rank descending so the
 * leader sits at the top.
 *
 * Answers the analyst's "who's winning this race and by how much" question
 * at a glance. Pair with a Recent activity section to also answer "is this
 * space hot or stalled".
 */
@Component({
  selector: 'app-detail-panel-phase-race',
  standalone: true,
  imports: [DetailPanelMiniPhaseBarComponent],
  template: `
    <div class="mb-3 flex items-baseline justify-between gap-2">
      <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        {{ label() }}
      </p>
      <p class="font-mono text-[9px] uppercase tracking-wider text-slate-300">
        Pre &middot; P1 &middot; P2 &middot; P3 &middot; P4 &middot; App &middot; L
      </p>
    </div>
    <div class="space-y-2">
      @for (entry of sortedEntries(); track entry.id) {
        <div class="flex items-center gap-3">
          <div class="w-[110px]">
            <p class="truncate text-[12px] font-medium text-slate-900">{{ entry.name }}</p>
            <p class="truncate font-mono text-[10px] text-slate-500">{{ entry.subtitle }}</p>
          </div>
          <app-detail-panel-mini-phase-bar [currentPhase]="entry.phase" />
          <span
            class="w-7 text-right font-mono text-[10px] font-semibold tabular-nums"
            [style.color]="phaseColor(entry.phase)"
          >
            {{ phaseDisplay(entry.phase) }}
          </span>
        </div>
      }
    </div>
  `,
})
export class DetailPanelPhaseRaceComponent {
  readonly label = input<string>('Phase progress');
  readonly entries = input.required<PhaseRaceEntry[]>();

  protected sortedEntries(): PhaseRaceEntry[] {
    return [...this.entries()].sort(
      (a, b) => RING_DEV_RANK[b.phase] - RING_DEV_RANK[a.phase]
    );
  }

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase];
  }

  protected phaseDisplay(phase: RingPhase): string {
    return PHASE_DISPLAY[phase] ?? phase;
  }
}
