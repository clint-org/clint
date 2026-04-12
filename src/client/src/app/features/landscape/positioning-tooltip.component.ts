import { Component, computed, input } from '@angular/core';

import { PositioningBubble } from '../../core/models/landscape.model';

@Component({
  selector: 'app-positioning-tooltip',
  standalone: true,
  template: `
    @if (bubble()) {
      @let b = bubble()!;
      <div
        class="fixed z-50 pointer-events-none bg-slate-800 text-white text-xs rounded-md px-3 py-2 shadow-lg max-w-56"
        [style.left.px]="x()"
        [style.top.px]="y()"
        [style.transform]="'translate(-50%, -100%) translateY(-10px)'"
        role="tooltip"
      >
        <div class="font-semibold mb-0.5">{{ fullLabel() }}</div>
        <div class="text-slate-300">
          {{ b.competitor_count }} {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }},
          highest phase: {{ b.highest_phase }}
        </div>
        <div class="text-slate-300">{{ b.unit_count }} {{ countUnit() }}</div>
        @if (topCompanies().length > 0) {
          <div class="text-slate-400 mt-1 border-t border-slate-600 pt-1">
            {{ topCompanies().join(', ') }}{{ b.products.length > 3 ? ', ...' : '' }}
          </div>
        }
        <div class="text-slate-500 mt-0.5">Click for details</div>
      </div>
    }
  `,
})
export class PositioningTooltipComponent {
  readonly bubble = input<PositioningBubble | null>(null);
  readonly x = input<number>(0);
  readonly y = input<number>(0);
  readonly countUnit = input<string>('products');

  /** Derive full name from group_keys instead of the abbreviation-based label. */
  readonly fullLabel = computed<string>(() => {
    const b = this.bubble();
    if (!b) return '';
    const keys = b.group_keys;
    const parts: string[] = [];
    if (keys['moa_name']) parts.push(keys['moa_name']);
    if (keys['therapeutic_area_name']) parts.push(keys['therapeutic_area_name']);
    if (keys['company_name']) parts.push(keys['company_name']);
    if (keys['roa_name']) parts.push(keys['roa_name']);
    return parts.length > 0 ? parts.join(' + ') : b.label;
  });

  readonly topCompanies = computed<string[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    const unique = [...new Set(b.products.map((p) => p.company_name))];
    return unique.slice(0, 3);
  });
}
