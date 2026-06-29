import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  normalizePhaseKey,
  PHASE_COLORS,
  PHASE_FALLBACK_COLOR,
  phaseShortLabel,
} from '../../core/models/phase-colors';
import { textColorOnWhite } from '../utils/color-contrast';

/**
 * Canonical phase label chip: mono "PH N" on a light slate chip, tinted with
 * the AA-darkened phase color (same source as the timeline asset-row chip and
 * the bullseye ring labels -- phaseShortLabel + textColorOnWhite). Renders
 * nothing when there is no phase, so call sites can drop it inline without a
 * surrounding guard.
 */
@Component({
  selector: 'app-phase-chip',
  standalone: true,
  template: `
    @if (label(); as text) {
      <span
        class="inline-flex shrink-0 items-center rounded-sm bg-slate-50 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ring-1 ring-slate-200"
        [style.color]="textColor()"
        >{{ text }}</span
      >
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhaseChipComponent {
  readonly phase = input<string | null | undefined>(null);

  protected readonly label = computed<string>(() => {
    const p = this.phase();
    return p ? phaseShortLabel(p) : '';
  });

  protected readonly textColor = computed<string>(() =>
    textColorOnWhite(PHASE_COLORS[normalizePhaseKey(this.phase())] ?? PHASE_FALLBACK_COLOR)
  );
}
