import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  PHASE_COLOR,
  RING_DEV_RANK,
  RingPhase,
  visibleRingOrder,
} from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';
import { CompanyTileComponent } from './company-tile.component';
import { DetailPanelEntityLinkDirective } from './detail-panel-entity-link.directive';
import { DetailPanelMiniPhaseBarComponent } from './detail-panel-mini-phase-bar.component';

export interface CompetitorRaceAsset {
  id: string;
  name: string;
  /** Trial count for the asset's trailing meta, or null to omit. */
  trialCount: number | null;
  phase: RingPhase;
}

export interface CompetitorRaceGroup {
  companyId: string;
  companyName: string;
  companyLogoUrl: string | null;
  /** The company's best (furthest) phase; used to order groups lead-first. */
  bestPhase: RingPhase;
  assets: CompetitorRaceAsset[];
}

/**
 * Competitive phase race grouped by company. Companies are ordered lead-first
 * (furthest phase wins), each company's assets sit beneath its tile against a
 * single shared phase axis, and the overall leader asset is emphasized with a
 * brand accent rule and bolder name.
 *
 * Answers "who leads this mechanism and by how much" in one read, without the
 * duplicate roster the old pane carried. Phase colors are fixed clinical data
 * colors and are never whitelabeled; the leader rule is the one brand accent.
 */
@Component({
  selector: 'app-detail-panel-competitor-race',
  standalone: true,
  imports: [
    CompanyTileComponent,
    DetailPanelEntityLinkDirective,
    DetailPanelMiniPhaseBarComponent,
    RouterLink,
  ],
  template: `
    <!-- Shared phase axis, aligned to the bars below it. -->
    <div class="mb-2.5 flex items-center gap-3">
      <div class="w-[150px] shrink-0"></div>
      <div class="flex min-w-0 flex-1 gap-[3px]">
        @for (p of axis(); track p.phase) {
          <span class="flex flex-1 items-center justify-center gap-1">
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              [style.background]="p.color"
              aria-hidden="true"
            ></span>
            <span class="font-mono text-[9px] font-bold tracking-[0.04em] text-slate-400">{{
              p.short
            }}</span>
          </span>
        }
      </div>
      <span class="w-7 shrink-0"></span>
    </div>

    @for (group of orderedGroups(); track group.companyId; let last = $last) {
      <div [class.mb-3.5]="!last" [class.mb-1]="last">
        <div class="mb-1.5 flex items-center gap-2">
          <app-company-tile
            [name]="group.companyName"
            [logoUrl]="group.companyLogoUrl"
            [size]="20"
          />
          @if (canLink()) {
            <a
              [routerLink]="['/t', tenantId(), 's', spaceId(), 'profiles', 'companies', group.companyId]"
              appDetailPanelEntityLink
              class="truncate rounded-sm text-[12.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >{{ group.companyName }}</a
            >
          } @else {
            <span class="truncate text-[12.5px] font-bold text-slate-900">{{
              group.companyName
            }}</span>
          }
          <span class="shrink-0 font-mono text-[10px] text-slate-300"
            >{{ group.assets.length }} {{ group.assets.length === 1 ? 'asset' : 'assets' }}</span
          >
        </div>
        @for (asset of group.assets; track asset.id) {
          <div
            class="ml-0.5 flex items-center gap-2 border-l-2 py-1.5 pl-2"
            [class.border-brand-600]="asset.id === leaderId()"
            [class.border-transparent]="asset.id !== leaderId()"
          >
            <div class="w-[140px] shrink-0 truncate">
              @if (canLink()) {
                <a
                  [routerLink]="['/t', tenantId(), 's', spaceId(), 'profiles', 'assets', asset.id]"
                  appDetailPanelEntityLink
                  class="rounded-sm text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  [class.font-bold]="asset.id === leaderId()"
                  [class.font-medium]="asset.id !== leaderId()"
                  >{{ asset.name }}</a
                >
              } @else {
                <span
                  class="text-[13px] text-slate-900"
                  [class.font-bold]="asset.id === leaderId()"
                  [class.font-medium]="asset.id !== leaderId()"
                  >{{ asset.name }}</span
                >
              }
              @if (asset.trialCount !== null) {
                <span class="text-[11px] text-slate-400"
                  >&nbsp;· {{ asset.trialCount }}
                  {{ asset.trialCount === 1 ? 'trial' : 'trials' }}</span
                >
              }
            </div>
            <app-detail-panel-mini-phase-bar
              [currentPhase]="asset.phase"
              [showPreclinical]="showPreclinical()"
            />
            <span
              class="w-7 shrink-0 text-right font-mono text-[10.5px] font-bold tabular-nums"
              [style.color]="phaseColor(asset.phase)"
              >{{ phaseTag(asset.phase) }}</span
            >
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelCompetitorRaceComponent {
  readonly groups = input.required<CompetitorRaceGroup[]>();
  /** When false, the PRECLIN axis segment is omitted. */
  readonly showPreclinical = input(true);
  /**
   * Route scope for the company / asset manage-page links. When either is
   * absent the names render as plain text (no dead links).
   */
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

  /** True when both route scope ids are present, so names become links. */
  protected readonly canLink = computed(() => !!this.tenantId() && !!this.spaceId());

  protected readonly axis = computed(() =>
    visibleRingOrder(this.showPreclinical()).map((phase) => ({
      phase,
      short: this.phaseTag(phase),
      color: PHASE_COLOR[phase] ?? '#64748b',
    }))
  );

  /** Companies ordered lead-first by their best phase, then by asset count. */
  protected readonly orderedGroups = computed<CompetitorRaceGroup[]>(() =>
    [...this.groups()].sort((a, b) => {
      const cmp = RING_DEV_RANK[b.bestPhase] - RING_DEV_RANK[a.bestPhase];
      if (cmp !== 0) return cmp;
      return b.assets.length - a.assets.length;
    })
  );

  /** The single furthest-developed asset across all groups. */
  protected readonly leaderId = computed<string | null>(() => {
    let lead: CompetitorRaceAsset | null = null;
    for (const g of this.groups()) {
      for (const a of g.assets) {
        if (!lead || RING_DEV_RANK[a.phase] > RING_DEV_RANK[lead.phase]) lead = a;
      }
    }
    return lead?.id ?? null;
  });

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }

  protected phaseTag(phase: RingPhase): string {
    const overrides: Partial<Record<RingPhase, string>> = {
      PRECLIN: 'Pre',
      APPROVED: 'App',
      LAUNCHED: 'L',
    };
    return overrides[phase] ?? phaseShortLabel(phase).replace('PH ', 'P');
  }
}
