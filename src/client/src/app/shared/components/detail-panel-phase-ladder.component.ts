import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { PHASE_COLOR, RING_DEV_RANK, RingPhase, visibleRingOrder } from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';

const EMPTY_SEGMENT = '#f1f5f9'; // slate-100

interface LadderCell {
  phase: RingPhase;
  short: string;
  color: string;
  reached: boolean;
  current: boolean;
}

/**
 * Segmented phase ladder with per-segment tick labels under the bar. Every
 * phase up to (and including) the reached phase is filled in its own phase
 * color; later phases recede to muted slate. The tick label for the reached
 * phase is emphasized in the phase color, making the radial bullseye position
 * explicit and linear.
 *
 * Phase colors are fixed clinical data colors and are never whitelabeled.
 */
@Component({
  selector: 'app-detail-panel-phase-ladder',
  standalone: true,
  template: `
    <div class="flex gap-[3px]" role="img" [attr.aria-label]="'Reached ' + reachedLabel()">
      @for (cell of ladder(); track cell.phase) {
        <span
          class="h-[9px] flex-1"
          [style.background]="cell.reached ? cell.color : emptySegment"
          aria-hidden="true"
        ></span>
      }
    </div>
    @if (ticks()) {
      <div class="mt-1 flex gap-[3px]">
        @for (cell of ladder(); track cell.phase) {
          <span
            class="flex-1 text-center font-mono text-[8.5px] font-bold tracking-[0.04em]"
            [style.color]="cell.current ? cell.color : '#cbd5e1'"
            aria-hidden="true"
            >{{ cell.short }}</span
          >
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelPhaseLadderComponent {
  readonly reached = input.required<RingPhase>();
  /** When false, the PRECLIN segment is omitted (space does not track it). */
  readonly showPreclinical = input(true);
  /** Renders per-segment tick labels under the bar. */
  readonly ticks = input<boolean>(true);

  protected readonly emptySegment = EMPTY_SEGMENT;

  protected readonly reachedLabel = computed(() => phaseShortLabel(this.reached()));

  protected readonly ladder = computed<LadderCell[]>(() => {
    const order = visibleRingOrder(this.showPreclinical());
    const reachedRank = RING_DEV_RANK[this.reached()];
    return order.map((phase) => ({
      phase,
      short: this.tickLabel(phase),
      color: PHASE_COLOR[phase] ?? '#64748b',
      reached: RING_DEV_RANK[phase] <= reachedRank,
      current: phase === this.reached(),
    }));
  });

  // Tick labels must fit the narrow segment width; the multi-letter short
  // labels ("PRECLIN", "APPROVED", "LAUNCHED") are abbreviated to match the
  // phase-race row convention.
  private tickLabel(phase: RingPhase): string {
    const overrides: Partial<Record<RingPhase, string>> = {
      PRECLIN: 'PRE',
      APPROVED: 'APP',
      LAUNCHED: 'L',
    };
    return overrides[phase] ?? phaseShortLabel(phase).replace('PH ', 'P');
  }
}
