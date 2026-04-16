import { Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import {
  PHASE_COLOR,
  RING_ORDER,
  PositioningBubble,
  PositioningProduct,
  RingPhase,
} from '../../core/models/landscape.model';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';

interface PhaseCount {
  phase: RingPhase;
  count: number;
}

@Component({
  selector: 'app-positioning-detail-panel',
  standalone: true,
  imports: [ButtonModule, DetailPanelShellComponent],
  template: `
    <app-detail-panel-shell
      [label]="'COMPETITIVE GROUP'"
      [showHeader]="!!bubble()"
      [showClose]="!!bubble()"
      (closed)="clearSelection.emit()"
    >
      @if (bubble()) {
        @let b = bubble()!;

        <div class="flex flex-col gap-3">
          <h2 class="text-xl font-bold leading-tight text-slate-900">{{ fullLabel() }}</h2>

          <!-- Summary stats (stacked) -->
          <section class="flex flex-col gap-0.5 border-t border-slate-50 pt-2 text-sm text-slate-600">
            <div><strong class="text-slate-800">{{ b.competitor_count }}</strong> {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }}</div>
            <div><strong class="text-slate-800">{{ b.unit_count }}</strong> {{ countUnit() }}</div>
          </section>

          <!-- Phase breakdown -->
          @if (phaseBreakdown().length > 0) {
            <section class="flex flex-col gap-1 border-t border-slate-50 pt-2">
              <div class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">PHASE BREAKDOWN</div>
              <div class="mt-0.5 flex flex-wrap gap-1">
                @for (entry of phaseBreakdown(); track entry.phase) {
                  <span
                    class="inline-block rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                    [style.background-color]="phaseColor(entry.phase) + '18'"
                    [style.color]="phaseColor(entry.phase)"
                  >{{ entry.phase }} {{ entry.count }}</span>
                }
              </div>
            </section>
          }

          <!-- Products -->
          <section class="flex flex-col gap-1 border-t border-slate-50 pt-2">
            <div class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">PRODUCTS ({{ b.products.length }})</div>
            <ul class="mt-1 flex flex-col gap-0.5 p-0">
              @for (product of sortedProducts(); track product.id) {
                <li class="list-none">
                  <button
                    type="button"
                    class="flex w-full cursor-pointer flex-col gap-0.5 rounded-sm border-none bg-transparent px-2 py-1.5 text-left hover:bg-slate-50"
                    (click)="openProduct.emit(product.id)"
                  >
                    <span class="text-[13px] font-medium text-slate-900">
                      {{ product.name }}
                      @if (product.generic_name) {
                        <span class="font-normal italic text-slate-400">({{ product.generic_name }})</span>
                      }
                    </span>
                    <span class="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                      <span class="text-slate-500">{{ product.company_name }}</span>
                      <span
                        class="inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-semibold"
                        [style.background-color]="phaseColor(product.highest_phase) + '18'"
                        [style.color]="phaseColor(product.highest_phase)"
                      >{{ product.highest_phase }}</span>
                      <span class="text-slate-400">{{ product.trial_count }} {{ product.trial_count === 1 ? 'trial' : 'trials' }}</span>
                      <span class="ml-auto text-slate-300">&rarr;</span>
                    </span>
                  </button>
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

      <!-- Actions slot -->
      @if (bubble()) {
        <div actions class="mt-auto border-t border-slate-100 px-5 py-3">
          <p-button
            label="Open in bullseye &rarr;"
            severity="secondary"
            styleClass="w-full"
            (onClick)="openInBullseye.emit()"
          />
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
  readonly openProduct = output<string>();
  readonly openInBullseye = output<void>();

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
    return parts.length > 0 ? parts.join(' / ') : b.label;
  });

  readonly sortedProducts = computed<PositioningProduct[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    return [...b.products].sort((a, b2) => b2.highest_phase_rank - a.highest_phase_rank);
  });

  readonly phaseBreakdown = computed<PhaseCount[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    const counts = new Map<RingPhase, number>();
    for (const p of b.products) {
      counts.set(p.highest_phase, (counts.get(p.highest_phase) ?? 0) + 1);
    }
    return [...RING_ORDER]
      .reverse()
      .filter((phase) => (counts.get(phase) ?? 0) > 0)
      .map((phase) => ({ phase, count: counts.get(phase)! }));
  });

  phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }
}
