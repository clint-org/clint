import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';

import {
  HeatmapBubble,
  HeatmapGrouping,
  HeatmapAsset,
  PHASE_COLOR,
  RING_DEV_RANK,
  RingPhase,
} from '../../core/models/landscape.model';
import { DEVELOPMENT_STATUS_LABELS } from '../../core/models/phase-colors';
import {
  CompetitorRaceGroup,
  DetailPanelCompetitorRaceComponent,
} from '../../shared/components/detail-panel-competitor-race.component';
import { PiReference } from '../../core/models/primary-intelligence.model';
import { DetailPanelEmptyStateComponent } from '../../shared/components/detail-panel-empty-state.component';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';
import { PiDetailSectionComponent } from '../../shared/components/pi-detail-section/pi-detail-section.component';

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
    DetailPanelCompetitorRaceComponent,
    DetailPanelEmptyStateComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    PiDetailSectionComponent,
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
            @if (leadAsset(); as lead) {
              <div class="flex items-baseline gap-1.5">
                <span
                  class="text-[13px] font-semibold"
                  [style.color]="phaseColor(lead.highest_phase)"
                  >{{ phaseLong(lead.highest_phase) }}</span
                >
                <span class="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400"
                  >Lead phase</span
                >
              </div>
            }
          </div>
          @if (leadAsset(); as lead) {
            <p class="mt-2 text-[12.5px] text-slate-500">
              <span class="font-semibold text-slate-900">{{ lead.company_name }}</span> leads with
              {{ lead.name }}.
            </p>
          }
        </app-detail-panel-section>

        @if (competitorGroups().length > 0) {
          <app-detail-panel-section label="Competitive phase progress">
            <app-detail-panel-competitor-race
              [groups]="competitorGroups()"
              [showPreclinical]="showPreclinical()"
              [tenantId]="tenantId()"
              [spaceId]="spaceId()"
            />
          </app-detail-panel-section>
        }

        @if (piReferences().length > 0) {
          <app-detail-panel-section label="Primary intelligence" [piMark]="true">
            <app-pi-detail-section
              [references]="piReferences()"
              [countLabel]="piCountLabel()"
              (referenceClick)="onPiReferenceClick($event)"
            />
          </app-detail-panel-section>
        }
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
  /** Route scope forwarded to the competitor race for company / asset links. */
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

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

  /** The single furthest-developed asset in the bubble (the leader). */
  readonly leadAsset = computed<HeatmapAsset | null>(() => {
    const products = this.bubble()?.products ?? [];
    if (products.length === 0) return null;
    return products.reduce((best, p) =>
      RING_DEV_RANK[p.highest_phase] > RING_DEV_RANK[best.highest_phase] ? p : best
    );
  });

  /**
   * Bubble products grouped by company for the competitor race. company_id /
   * company_name are already present on each product, so this is a pure
   * re-layout of loaded data with no extra query.
   */
  readonly competitorGroups = computed<CompetitorRaceGroup[]>(() => {
    const products = this.bubble()?.products ?? [];
    const byCompany = new Map<string, CompetitorRaceGroup>();
    for (const p of products) {
      let group = byCompany.get(p.company_id);
      if (!group) {
        group = {
          companyId: p.company_id,
          companyName: p.company_name,
          companyLogoUrl: p.company_logo_url,
          bestPhase: p.highest_phase,
          assets: [],
        };
        byCompany.set(p.company_id, group);
      }
      if (RING_DEV_RANK[p.highest_phase] > RING_DEV_RANK[group.bestPhase]) {
        group.bestPhase = p.highest_phase;
      }
      group.assets.push({
        id: p.id,
        name: p.name,
        trialCount: p.trial_count,
        phase: p.highest_phase,
      });
    }
    // Within each company, order assets lead-first.
    for (const group of byCompany.values()) {
      group.assets.sort((a, x) => RING_DEV_RANK[x.phase] - RING_DEV_RANK[a.phase]);
    }
    return [...byCompany.values()];
  });

  /** PI-bearing assets in this group, mapped to the shared reference shape. */
  protected readonly piReferences = computed<PiReference[]>(() =>
    (this.bubble()?.products ?? [])
      .filter((p) => p.has_intelligence)
      .map((p) => ({
        id: p.id,
        entity_type: 'product' as const,
        entity_id: p.id,
        entity_name: p.name,
        headline: p.name,
      }))
  );

  /** "N of M assets have intelligence" summary for the PI section. */
  protected readonly piCountLabel = computed<string | null>(() => {
    const b = this.bubble();
    if (!b) return null;
    const total = b.products.length;
    const n = b.intelligence_count ?? this.piReferences().length;
    return n > 0 ? `${n} of ${total} assets have intelligence` : null;
  });

  protected onPiReferenceClick(ref: PiReference): void {
    this.openAsset.emit(ref.entity_id);
  }

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }

  protected phaseLong(phase: RingPhase): string {
    return DEVELOPMENT_STATUS_LABELS[phase] ?? phase;
  }
}
