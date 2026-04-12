import { Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import {
  PHASE_COLOR,
  PositioningBubble,
  PositioningProduct,
  RingPhase,
} from '../../core/models/landscape.model';

@Component({
  selector: 'app-positioning-detail-panel',
  standalone: true,
  imports: [ButtonModule],
  template: `
    <aside class="landscape-detail-panel" aria-live="polite">
      @if (bubble()) {
        @let b = bubble()!;
        <div class="landscape-detail-header">
          <div class="landscape-detail-label">SELECTED</div>
          <button
            type="button"
            class="landscape-detail-clear"
            (click)="clearSelection.emit()"
            aria-label="Clear selection"
          >&times;</button>
        </div>

        <h2 class="landscape-detail-name">{{ fullLabel() }}</h2>

        <section class="landscape-detail-section">
          <div class="flex items-center gap-3 text-sm text-slate-600">
            <span><strong class="text-slate-800">{{ b.competitor_count }}</strong> {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }}</span>
            <span class="w-px h-3.5 bg-slate-200"></span>
            <span>
              <span
                class="inline-block w-2 h-2 rounded-full mr-1"
                [style.background-color]="phaseColor(b.highest_phase)"
              ></span>
              {{ b.highest_phase }}
            </span>
            <span class="w-px h-3.5 bg-slate-200"></span>
            <span><strong class="text-slate-800">{{ b.unit_count }}</strong> {{ countUnit() }}</span>
          </div>
        </section>

        <section class="landscape-detail-section">
          <div class="landscape-detail-label">PRODUCTS ({{ b.products.length }})</div>
          <ul class="landscape-detail-trial-list">
            @for (product of sortedProducts(); track product.id) {
              <li class="landscape-detail-trial-row">
                <div class="landscape-detail-trial-link" style="cursor: default;">
                  <span class="landscape-detail-trial-name">{{ product.name }}</span>
                  <span class="landscape-detail-trial-meta">
                    <span class="text-slate-500">{{ product.company_name }}</span>
                    <span
                      class="inline-block rounded-sm text-[10px] px-1.5 py-0.5 font-semibold"
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
      } @else {
        <div class="landscape-detail-empty">
          <div class="landscape-detail-label">CLICK A BUBBLE TO SEE DETAILS</div>
          <p class="landscape-detail-summary">
            {{ totalBubbles() }} {{ totalBubbles() === 1 ? 'group' : 'groups' }} plotted
          </p>
        </div>
      }
    </aside>
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
