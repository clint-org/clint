import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  HeatmapBubble,
  HeatmapAsset,
  PHASE_COLOR,
  RingPhase,
} from '../../core/models/landscape.model';
import { DEVELOPMENT_STATUS_LABELS } from '../../core/models/phase-colors';
import { CompanyTileComponent } from '../../shared/components/company-tile.component';
import { DetailPanelMiniPhaseBarComponent } from '../../shared/components/detail-panel-mini-phase-bar.component';
import { PhaseChipComponent } from '../../shared/components/phase-chip.component';
import { fadeTooltipAnimation } from '../../shared/animations/fade-tooltip.animation';

/**
 * Heatmap cell hover preview. Hovering a populated cell names the assets that
 * sit at that cell's phase right away (company tile + name + company + mini
 * progress), so a competitive read happens on hover instead of after a click.
 * Roster is derived from the row bubble's already-loaded products; no query.
 *
 * Placement mirrors the bullseye tooltip: the card sits beside the cursor and
 * never over the grid. Phase colors are fixed clinical data colors.
 */
@Component({
  selector: 'app-heatmap-cell-tooltip',
  standalone: true,
  imports: [CompanyTileComponent, DetailPanelMiniPhaseBarComponent, PhaseChipComponent],
  animations: [fadeTooltipAnimation],
  template: `
    @if (bubble() && phase()) {
      @let b = bubble()!;
      @let here = assetsAtPhase();
      <div
        @fadeTooltip
        class="pointer-events-none fixed z-50 w-[320px] border border-slate-200 bg-white text-slate-700 shadow-xl"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
        [style.transform]="pos().transform"
        role="tooltip"
      >
        <!-- Header: phase dot + group name + phase chip -->
        <div class="flex items-center gap-2.5 border-b border-slate-100 px-3.5 py-3">
          <span
            class="h-[9px] w-[9px] shrink-0 rounded-full"
            [style.background]="phaseColor(phase()!)"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 flex-1 truncate text-[13.5px] font-bold leading-tight text-slate-900">{{
            b.label
          }}</span>
          <app-phase-chip class="shrink-0" [phase]="phase()" />
        </div>

        <div class="px-3.5 py-3">
          <p class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {{ here.length }} {{ here.length === 1 ? 'asset' : 'assets' }} at
            {{ phaseLong(phase()!) }}
          </p>
          @for (a of here; track a.id) {
            <div class="flex items-center gap-2.5 py-1.5">
              <app-company-tile
                [name]="a.company_name"
                [logoUrl]="a.company_logo_url"
                [size]="20"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-semibold text-slate-900">{{ a.name }}</div>
                <div class="truncate text-[11px] text-slate-500">{{ a.company_name }}</div>
              </div>
              <div class="w-[72px] shrink-0">
                <app-detail-panel-mini-phase-bar
                  [currentPhase]="a.highest_phase"
                  [showPreclinical]="showPreclinical()"
                />
              </div>
            </div>
          }
          @if (otherCount() > 0) {
            <div class="mt-2 border-t border-slate-100 pt-2.5 text-[11.5px] text-slate-500">
              +{{ otherCount() }} more across other phases · {{ b.competitor_count }}
              {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }}
            </div>
          }
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapCellTooltipComponent {
  readonly bubble = input<HeatmapBubble | null>(null);
  readonly phase = input<RingPhase | null>(null);
  readonly x = input<number>(0);
  readonly y = input<number>(0);
  /** Whether the space tracks preclinical; narrows the mini phase bars. */
  readonly showPreclinical = input<boolean>(true);

  private readonly rosterCap = 5;

  /** Assets in the bubble whose highest phase matches the hovered cell. */
  protected readonly assetsAtPhase = computed<HeatmapAsset[]>(() => {
    const b = this.bubble();
    const p = this.phase();
    if (!b || !p) return [];
    return b.products.filter((a) => a.highest_phase === p).slice(0, this.rosterCap);
  });

  /** Bubble assets not shown in the at-phase roster preview. */
  protected readonly otherCount = computed(() => {
    const b = this.bubble();
    const p = this.phase();
    if (!b || !p) return 0;
    const atPhase = b.products.filter((a) => a.highest_phase === p);
    const shown = Math.min(atPhase.length, this.rosterCap);
    return b.products.length - shown;
  });

  /**
   * Place the card beside the cursor (never over the grid): right of the
   * cursor when it is in the left half of the viewport, otherwise left.
   * Vertical anchor is centered on the cursor and clamped on-screen.
   */
  protected readonly pos = computed(() => {
    const x = this.x();
    const y = this.y();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const gap = 18;
    const placeRight = x <= vw / 2;
    return {
      left: placeRight ? x + gap : x - gap,
      top: Math.min(Math.max(y, 140), vh - 140),
      transform: placeRight ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
    };
  });

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }

  protected phaseLong(phase: RingPhase): string {
    return DEVELOPMENT_STATUS_LABELS[phase] ?? phase;
  }
}
