import { Component, computed, input } from '@angular/core';

import { PHASE_COLOR, RING_DEV_RANK, RING_ORDER, RingPhase } from '../../core/models/landscape.model';

const EMPTY_SEGMENT = '#e2e8f0'; // slate-200

/**
 * Compact 7-segment phase bar (PRECLIN -> LAUNCHED). Each filled segment
 * uses its own phase color from PHASE_COLOR; segments past the current
 * phase render as muted slate.
 *
 * Used by the positioning Phase race, where each row is a product and the
 * bar shows how far it has reached. Distinct from the dashboard's
 * SVG-based PhaseBarComponent, which is a date-axis visualization with
 * start/end semantics.
 */
@Component({
  selector: 'app-detail-panel-mini-phase-bar',
  standalone: true,
  template: `
    <div class="flex flex-1 gap-px" [attr.aria-label]="'Reached ' + currentPhase()">
      @for (phase of phases; track phase) {
        <div
          class="h-2 flex-1 rounded-sm"
          [style.background]="segmentColor(phase)"
          [attr.aria-hidden]="true"
        ></div>
      }
    </div>
  `,
})
export class DetailPanelMiniPhaseBarComponent {
  readonly currentPhase = input.required<RingPhase>();

  protected readonly phases = RING_ORDER;

  private readonly currentRank = computed(() => RING_DEV_RANK[this.currentPhase()]);

  protected segmentColor(phase: RingPhase): string {
    return RING_DEV_RANK[phase] <= this.currentRank() ? PHASE_COLOR[phase] : EMPTY_SEGMENT;
  }
}
