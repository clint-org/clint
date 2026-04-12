import { Component, computed, input } from '@angular/core';

import { BullseyeProduct } from '../../core/models/landscape.model';

@Component({
  selector: 'app-bullseye-tooltip',
  standalone: true,
  template: `
    @if (product()) {
      @let p = product()!;
      <div
        class="fixed z-50 pointer-events-none bg-slate-800 text-white text-xs rounded-md px-3 py-2 shadow-lg max-w-56"
        [style.left.px]="x()"
        [style.top.px]="y()"
        [style.transform]="'translate(-50%, -100%) translateY(-10px)'"
        role="tooltip"
      >
        <div class="font-semibold mb-0.5">{{ p.name }}</div>
        @if (p.generic_name) {
          <div class="text-slate-300">{{ p.generic_name }}</div>
        }
        <div class="text-slate-300">{{ p.company_name }}, highest phase: {{ p.highest_phase }}</div>
        <div class="text-slate-300">
          {{ p.trials.length }} {{ p.trials.length === 1 ? 'trial' : 'trials' }}
        </div>
        @if (moaList().length > 0) {
          <div class="text-slate-400 mt-1 border-t border-slate-600 pt-1">
            {{ moaList().join(', ') }}
          </div>
        }
        <div class="text-slate-500 mt-0.5">Click for details</div>
      </div>
    }
  `,
})
export class BullseyeTooltipComponent {
  readonly product = input<BullseyeProduct | null>(null);
  readonly x = input<number>(0);
  readonly y = input<number>(0);

  readonly moaList = computed<string[]>(() => {
    const p = this.product();
    if (!p) return [];
    return p.moas.map((m) => m.name);
  });
}
