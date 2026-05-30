import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { BullseyeAsset } from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';
import { badgeTypeLabel } from '../../shared/components/change-badge/change-badge.logic';
import { fadeTooltipAnimation } from '../../shared/animations/fade-tooltip.animation';

@Component({
  selector: 'app-bullseye-tooltip',
  imports: [],
  animations: [fadeTooltipAnimation],
  template: `
    @if (product()) {
      @let p = product()!;
      <div
        @fadeTooltip
        class="fixed z-50 pointer-events-none bg-slate-800 text-white text-xs rounded-md px-3 py-2 shadow-lg max-w-64"
        [style.left.px]="x()"
        [style.top.px]="y()"
        [style.transform]="'translate(-50%, -100%) translateY(-10px)'"
        role="tooltip"
      >
        <div class="font-semibold mb-0.5">{{ p.name }}</div>
        @if (p.generic_name) {
          <div class="text-slate-300">{{ p.generic_name }}</div>
        }
        <div class="text-slate-300">
          {{ p.company_name }}, highest phase: {{ phaseLabel(p.highest_phase) }}
        </div>
        <div class="text-slate-300">
          {{ p.trials.length }} {{ p.trials.length === 1 ? 'trial' : 'trials' }}
        </div>
        @if (p.has_recent_activity) {
          <div class="text-amber-300 font-mono mt-1">
            {{ recentChangeLabel(p) }}
          </div>
        }
        @if (p.intelligence_count > 0) {
          <div class="text-cyan-300 mt-0.5">
            {{ p.intelligence_count }} intelligence
            {{ p.intelligence_count === 1 ? 'note' : 'notes' }}
          </div>
        }
        @if (spokeCount() > 1) {
          <div class="text-slate-400 mt-0.5">Appears on {{ spokeCount() }} spokes</div>
        }
        @if (moaList().length > 0) {
          <div class="text-slate-400 mt-1 border-t border-slate-600 pt-1">
            {{ moaList().join(', ') }}
          </div>
        }
        <div class="text-slate-500 mt-0.5">Click for details</div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BullseyeTooltipComponent {
  readonly product = input<BullseyeAsset | null>(null);
  readonly x = input<number>(0);
  readonly y = input<number>(0);
  readonly spokeCount = input<number>(0);

  readonly moaList = computed<string[]>(() => {
    const p = this.product();
    if (!p) return [];
    return p.moas.map((m) => m.name);
  });

  protected phaseLabel(p: string): string {
    return phaseShortLabel(p);
  }

  protected recentChangeLabel(p: BullseyeAsset): string {
    const n = p.recent_changes_count ?? 0;
    const label = badgeTypeLabel(p.most_recent_change_type ?? null);
    if (label && n > 1) return `${label} (+${n - 1} more)`;
    if (label) return label;
    return `${n} recent ${n === 1 ? 'change' : 'changes'}`;
  }
}
