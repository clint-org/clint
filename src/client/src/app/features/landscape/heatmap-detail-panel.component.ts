import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';

import {
  HeatmapBubble,
  HeatmapGrouping,
  HeatmapAsset,
} from '../../core/models/landscape.model';
import { DetailPanelEmptyStateComponent } from '../../shared/components/detail-panel-empty-state.component';
import { DetailPanelEntityListComponent } from '../../shared/components/detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from '../../shared/components/detail-panel-entity-row.component';
import {
  DetailPanelPhaseRaceComponent,
  PhaseRaceEntry,
} from '../../shared/components/detail-panel-phase-race.component';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';

const GROUPING_LABEL: Record<HeatmapGrouping, string> = {
  moa: 'MOA group',
  indication: 'Indication group',
  'moa+indication': 'MOA + Indication group',
  company: 'Company group',
  roa: 'ROA group',
};

/**
 * Bullseye destination per heatmap grouping. Mirrors
 * `heatmap-view.bullseyeSegment()`. The `moa+indication` row
 * intentionally drops MOA and lands on Indication; the tooltip names
 * the resolved dimension so the user can predict the navigation.
 */
const BULLSEYE_TARGET_LABEL: Record<HeatmapGrouping, string> = {
  moa: 'mechanism of action',
  indication: 'indication',
  'moa+indication': 'indication',
  company: 'company',
  roa: 'route of administration',
};

@Component({
  selector: 'app-heatmap-detail-panel',
  imports: [
    DetailPanelEmptyStateComponent,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelPhaseRaceComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    Tooltip,
  ],
  template: `
    <app-detail-panel-shell
      [label]="headerLabel()"
      [labelTone]="bubble() ? 'brand' : 'muted'"
      [showClose]="!!bubble()"
      (closed)="clearSelection.emit()"
    >
      @if (bubble(); as b) {
        <h2 class="text-base font-semibold leading-snug text-slate-900">{{ fullLabel() }}</h2>

        <app-detail-panel-section [first]="true">
          <div class="flex items-baseline gap-6 text-[13px] text-slate-700">
            <div>
              <span class="text-base font-semibold tabular-nums text-slate-900">{{
                b.competitor_count
              }}</span>
              <span class="ml-1 text-slate-500">{{
                b.competitor_count === 1 ? 'competitor' : 'competitors'
              }}</span>
            </div>
            <div>
              <span class="text-base font-semibold tabular-nums text-slate-900">{{
                b.unit_count
              }}</span>
              <span class="ml-1 text-slate-500">{{ countUnit() }}</span>
            </div>
          </div>
        </app-detail-panel-section>

        @if (raceEntries().length > 0) {
          <app-detail-panel-section>
            <app-detail-panel-phase-race
              [entries]="raceEntries()"
              [showPreclinical]="showPreclinical()"
            />
          </app-detail-panel-section>
        }

        <app-detail-panel-section [label]="'Assets (' + b.products.length + ')'">
          <app-detail-panel-entity-list>
            @for (product of sortedAssets(); track product.id) {
              <app-detail-panel-entity-row (rowClick)="openAsset.emit(product.id)">
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate text-[13px] font-medium text-slate-900">
                    {{ product.name }}
                    @if (product.generic_name) {
                      <span class="font-normal italic text-slate-400"
                        >({{ product.generic_name }})</span
                      >
                    }
                  </span>
                  <span class="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                    <span class="truncate text-slate-500">{{ product.company_name }}</span>
                    <span class="shrink-0"
                      >{{ product.trial_count }}
                      {{ product.trial_count === 1 ? 'trial' : 'trials' }}</span
                    >
                  </span>
                </span>
              </app-detail-panel-entity-row>
            }
          </app-detail-panel-entity-list>
        </app-detail-panel-section>
      } @else {
        <app-detail-panel-empty-state prompt="Click a row to see details">
          <p class="mt-2 text-[13px] text-slate-700">
            <span class="text-base font-semibold tabular-nums text-slate-900">{{
              totalBubbles()
            }}</span>
            {{ totalBubbles() === 1 ? 'group' : 'groups' }} in the matrix
          </p>
        </app-detail-panel-empty-state>
      }

      @if (bubble()) {
        <div footer class="border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            class="inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-brand-600 hover:text-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
            [pTooltip]="openInBullseyeTooltip()"
            tooltipPosition="top"
            (click)="openInBullseye.emit()"
          >
            Open in bullseye
            <i class="fa-solid fa-arrow-right text-[10px]" aria-hidden="true"></i>
          </button>
        </div>
      }
    </app-detail-panel-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapDetailPanelComponent {
  readonly bubble = input<HeatmapBubble | null>(null);
  readonly countUnit = input<string>('assets');
  readonly totalBubbles = input<number>(0);
  readonly grouping = input<HeatmapGrouping>('moa');
  /** Whether the space tracks preclinical; forwarded to the phase-race scale. */
  readonly showPreclinical = input(true);

  readonly clearSelection = output<void>();
  readonly openAsset = output<string>();
  readonly openInBullseye = output<void>();

  readonly headerLabel = computed(() =>
    this.bubble() ? GROUPING_LABEL[this.grouping()] : 'Heatmap · overview'
  );

  readonly openInBullseyeTooltip = computed(
    () => `Open in Bullseye, grouped by ${BULLSEYE_TARGET_LABEL[this.grouping()]}`
  );

  readonly fullLabel = computed(() => {
    const b = this.bubble();
    if (!b) return '';
    const k = b.group_keys;
    const parts = [
      k['moa_name'],
      k['indication_name'],
      k['company_name'],
      k['roa_name'],
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : b.label;
  });

  readonly sortedAssets = computed<HeatmapAsset[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    return [...b.products].sort((a, x) => x.highest_phase_rank - a.highest_phase_rank);
  });

  readonly raceEntries = computed<PhaseRaceEntry[]>(() =>
    this.sortedAssets().map((p) => ({
      id: p.id,
      name: p.name,
      subtitle: p.company_name,
      phase: p.highest_phase,
    }))
  );
}
