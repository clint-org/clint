import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  PHASE_COLOR,
  RING_DEV_RANK,
  RING_ORDER,
  RingPhase,
} from '../../core/models/landscape.model';

const EMPTY_SEGMENT = '#e2e8f0'; // slate-200

/**
 * Compact 7-segment phase bar (PRECLIN -> LAUNCHED). Each filled segment
 * uses its own phase color from PHASE_COLOR; segments past the current
 * phase render as muted slate.
 *
 * Host element is flex-1 so the bar grows to fill available space when
 * placed inside a flex row (the typical Phase race layout).
 */
@Component({
  selector: 'app-detail-panel-mini-phase-bar',
  standalone: true,
  host: {
    class: 'flex min-w-0 flex-1 items-center gap-px',
    role: 'img',
    '[attr.aria-label]': '"Reached " + currentPhase()',
  },
  template: `
    @for (phase of phases; track phase) {
      <span
        class="h-2 flex-1 rounded-sm"
        [style.background]="segmentColor(phase)"
        aria-hidden="true"
      ></span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelMiniPhaseBarComponent {
  readonly currentPhase = input.required<RingPhase>();

  protected readonly phases = RING_ORDER;

  private readonly currentRank = computed(() => RING_DEV_RANK[this.currentPhase()]);

  protected segmentColor(phase: RingPhase): string {
    return RING_DEV_RANK[phase] <= this.currentRank() ? PHASE_COLOR[phase] : EMPTY_SEGMENT;
  }
}
