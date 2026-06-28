import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

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
import {
  IntelligenceEntityType,
  PiReference,
} from '../../core/models/primary-intelligence.model';
import { PrimaryIntelligenceService } from '../../core/services/primary-intelligence.service';
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

@Component({
  selector: 'app-heatmap-detail-panel',
  imports: [
    DetailPanelCompetitorRaceComponent,
    DetailPanelEmptyStateComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    PiDetailSectionComponent,
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

        @if (allPiReferences().length > 0) {
          <app-detail-panel-section label="Primary intelligence" [piMark]="true">
            <app-pi-detail-section
              [references]="allPiReferences()"
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
  /** Routes to the PI-bearing entity's profile (where its intelligence lives). */
  readonly openIntelligence = output<{ entityType: IntelligenceEntityType; entityId: string }>();

  readonly headerLabel = computed(() =>
    this.bubble() ? GROUPING_LABEL[this.grouping()] : 'Heatmap · overview'
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

  private readonly intelligenceService = inject(PrimaryIntelligenceService);

  /**
   * Real PI references for the group's PI-bearing assets. Each reference carries
   * the true entity (a trial, the asset, or a company) the intelligence is
   * attached to, so a click routes to the page that actually holds the PI --
   * not always the asset. Populated by the fetch effect below; empty until the
   * per-asset notes resolve.
   */
  protected readonly piReferences = signal<PiReference[]>([]);

  /**
   * Company-level intelligence references for a company-grouped bubble.
   * Populated only when `group_keys.company_id` is present (i.e. grouping=company).
   * Each reference has entity_type='company' and entity_id=company_id so clicks
   * navigate to the company's intelligence profile.
   */
  protected readonly companyIntelligenceRefs = signal<PiReference[]>([]);

  /**
   * Per-asset/trial PI notes plus any company-level briefs, in one list.
   * Company briefs carry entity_type 'company' so they render with a "Company"
   * tag in the same section rather than a separate one.
   */
  protected readonly allPiReferences = computed<PiReference[]>(() => [
    ...this.piReferences(),
    ...this.companyIntelligenceRefs(),
  ]);

  constructor() {
    // When the selected bubble (or its space) changes, load the real PI notes
    // for every PI-bearing asset in the group and aggregate them, deduped by
    // PI id. Mirrors the bullseye panel, which fetches the same notes per
    // selected asset; here we fan out across the group's assets. A bubble-
    // identity guard discards a stale response if the selection moved on.
    effect(() => {
      const b = this.bubble();
      const spaceId = this.spaceId();
      this.piReferences.set([]);
      if (!b || !spaceId) return;
      const assetIds = b.products.filter((p) => p.has_intelligence).map((p) => p.id);
      if (assetIds.length === 0) return;
      void (async () => {
        try {
          const perAsset = await Promise.all(
            assetIds.map((id) => this.intelligenceService.getIntelligenceNotesForAsset(spaceId, id))
          );
          if (this.bubble() !== b) return;
          const byId = new Map<string, PiReference>();
          for (const notes of perAsset) {
            for (const n of notes) {
              byId.set(n.id, {
                id: n.id,
                entity_type: n.entity_type,
                entity_id: n.entity_id,
                entity_name: n.entity_name,
                headline: n.headline,
              });
            }
          }
          this.piReferences.set([...byId.values()]);
        } catch {
          if (this.bubble() === b) this.piReferences.set([]);
        }
      })();
    });

    // When the bubble represents a company (group_keys.company_id present),
    // also fetch company-level intelligence. This is separate from the per-asset
    // PI above: a company may own briefs that are not tied to any single asset.
    effect(() => {
      const b = this.bubble();
      const spaceId = this.spaceId();
      this.companyIntelligenceRefs.set([]);
      if (!b || !spaceId) return;
      const companyId = b.group_keys['company_id'];
      if (!companyId) return;
      const companyName = b.group_keys['company_name'] ?? null;
      void (async () => {
        try {
          const briefs = await this.intelligenceService.listIntelligenceForEntity(
            spaceId,
            'company',
            companyId
          );
          if (this.bubble() !== b) return;
          const refs: PiReference[] = briefs
            .filter((br) => br.published !== null)
            .map((br) => ({
              id: br.published!.record.id,
              entity_type: 'company' as IntelligenceEntityType,
              entity_id: companyId,
              entity_name: companyName,
              headline: br.published!.record.headline,
            }));
          this.companyIntelligenceRefs.set(refs);
        } catch {
          if (this.bubble() === b) this.companyIntelligenceRefs.set([]);
        }
      })();
    });
  }

  /** "N of M assets have intelligence" summary for the PI section. */
  protected readonly piCountLabel = computed<string | null>(() => {
    const b = this.bubble();
    if (!b) return null;
    const total = b.products.length;
    const n = b.intelligence_count ?? this.piReferences().length;
    return n > 0 ? `${n} of ${total} assets have intelligence` : null;
  });

  protected onPiReferenceClick(ref: PiReference): void {
    this.openIntelligence.emit({
      entityType: ref.entity_type as IntelligenceEntityType,
      entityId: ref.entity_id,
    });
  }

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }

  protected phaseLong(phase: RingPhase): string {
    return DEVELOPMENT_STATUS_LABELS[phase] ?? phase;
  }
}
