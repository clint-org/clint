import { Component, computed, input, output } from '@angular/core';

import {
  PHASE_COLOR,
  PositioningBubble,
  PositioningProduct,
  RingPhase,
} from '../../core/models/landscape.model';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';

@Component({
  selector: 'app-positioning-detail-panel',
  standalone: true,
  imports: [DetailPanelShellComponent],
  template: `
    <app-detail-panel-shell
      [label]="'SELECTED'"
      [showHeader]="!!bubble()"
      [showClose]="!!bubble()"
      (closed)="clearSelection.emit()"
    >
      @if (bubble()) {
        @let b = bubble()!;

        <div class="flex flex-col gap-3">
          <h2 class="text-xl font-bold leading-tight text-slate-900">{{ fullLabel() }}</h2>

          <!-- Summary stats -->
          <section class="flex flex-col gap-1 border-t border-slate-50 pt-2">
            <div class="flex items-center gap-3 text-sm text-slate-600">
              <span><strong class="text-slate-800">{{ b.competitor_count }}</strong> {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }}</span>
              <span class="h-3.5 w-px bg-slate-200"></span>
              <span>
                <span
                  class="mr-1 inline-block h-2 w-2 rounded-full"
                  [style.background-color]="phaseColor(b.highest_phase)"
                ></span>
                {{ b.highest_phase }}
              </span>
              <span class="h-3.5 w-px bg-slate-200"></span>
              <span><strong class="text-slate-800">{{ b.unit_count }}</strong> {{ countUnit() }}</span>
            </div>
          </section>

          <!-- Products -->
          <section class="flex flex-col gap-1 border-t border-slate-50 pt-2">
            <div class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">PRODUCTS ({{ b.products.length }})</div>
            <ul class="mt-1 flex flex-col gap-0.5 p-0">
              @for (product of sortedProducts(); track product.id) {
                <li class="list-none">
                  <div class="flex flex-col gap-0.5 rounded-sm px-2 py-1.5">
                    <span class="text-[13px] font-medium text-slate-900">{{ product.name }}</span>
                    <span class="flex gap-2 font-mono text-[11px] text-slate-400">
                      <span class="text-slate-500">{{ product.company_name }}</span>
                      <span
                        class="inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-semibold"
                        [style.background-color]="phaseColor(product.highest_phase) + '18'"
                        [style.color]="phaseColor(product.highest_phase)"
                      >{{ product.highest_phase }}</span>
                      <span class="text-slate-400">{{ product.trial_count }} {{ product.trial_count === 1 ? 'trial' : 'trials' }}</span>
                    </span>
                  </div>
                </li>
              }
            </ul>
          </section>
        </div>
      } @else {
        <!-- Empty state -->
        <div class="flex flex-col gap-3">
          <div class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">CLICK A BUBBLE TO SEE DETAILS</div>
          <p class="text-[13px] text-slate-700">
            {{ totalBubbles() }} {{ totalBubbles() === 1 ? 'group' : 'groups' }} plotted
          </p>
        </div>
      }
    </app-detail-panel-shell>
  `,
})
export class PositioningDetailPanelComponent {
  readonly bubble = input<PositioningBubble | null>(null);
  readonly countUnit = input<string>('products');
  readonly totalBubbles = input<number>(0);

  readonly clearSelection = output<void>();

  readonly fullLabel = computed(() => {
    const b = this.bubble();
    if (!b) return '';
    const k = b.group_keys;
    const parts = [
      k['moa_name'],
      k['therapeutic_area_name'],
      k['company_name'],
      k['roa_name'],
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' + ') : b.label;
  });

  readonly sortedProducts = computed<PositioningProduct[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    return [...b.products].sort((a, b2) => b2.highest_phase_rank - a.highest_phase_rank);
  });

  phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }
}
