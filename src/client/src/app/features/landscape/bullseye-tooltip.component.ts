import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  BullseyeAsset,
  PHASE_COLOR,
  RingPhase,
  visibleRingOrder,
} from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';
import { recentChangeLabel } from '../../shared/components/change-badge/change-badge.logic';
import { fadeTooltipAnimation } from '../../shared/animations/fade-tooltip.animation';

interface LadderCell {
  phase: RingPhase;
  short: string;
  color: string;
  reached: boolean;
  current: boolean;
}

/**
 * Bullseye drug hover preview. Light, on-brand card that echoes the chart mark:
 * an identity strip carries the name + company, the phase ladder makes the
 * radial position explicit, and the chart's signal rings (activity, intel,
 * multi-spoke) become structured chips. Phase / projection colors are fixed
 * data colors and never whitelabeled.
 */
@Component({
  selector: 'app-bullseye-tooltip',
  imports: [],
  animations: [fadeTooltipAnimation],
  template: `
    @if (product()) {
      @let p = product()!;
      <div
        @fadeTooltip
        class="fixed z-50 w-[300px] pointer-events-none border border-slate-200 bg-white text-slate-700 shadow-xl"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
        [style.transform]="pos().transform"
        role="tooltip"
      >
        <!-- Identity strip -->
        <div class="flex items-start gap-2.5 border-b border-slate-100 px-3.5 py-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-[14px] font-semibold leading-tight text-slate-900">
              {{ p.name }}
            </div>
            <div class="truncate text-[12px] italic text-slate-500">
              @if (p.generic_name) {
                <span>{{ p.generic_name }} · </span>
              }
              <span class="not-italic font-medium text-slate-600">{{ p.company_name }}</span>
            </div>
          </div>
          <!-- Live chart mark: phase-colored core ringed by the same signal
               rings the bullseye plots (orange = recent activity, brand =
               intelligence, dashed slate = multiple spokes). -->
          <svg
            class="mt-0.5 block shrink-0"
            width="30"
            height="30"
            viewBox="0 0 30 30"
            aria-hidden="true"
          >
            @for (ring of dotRings(); track ring.kind) {
              <circle
                cx="15"
                cy="15"
                fill="none"
                [attr.r]="ring.r"
                [attr.stroke]="ring.stroke"
                [attr.stroke-width]="ring.width"
                [attr.stroke-dasharray]="ring.dash"
              />
            }
            <circle cx="15" cy="15" r="4.5" [attr.fill]="phaseColor(p.highest_phase)" />
          </svg>
        </div>

        <div class="px-3.5 py-3">
          <!-- Phase ladder -->
          <div class="mb-1.5 flex items-center justify-between">
            <span class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"
              >Phase</span
            >
            <span
              class="font-mono text-[11px] font-bold uppercase tracking-[0.06em]"
              [style.color]="phaseColor(p.highest_phase)"
              >{{ phaseLabel(p.highest_phase) }}</span
            >
          </div>
          <div class="flex gap-[3px]">
            @for (cell of ladder(); track cell.phase) {
              <span
                class="h-[9px] flex-1"
                [style.background]="cell.reached ? cell.color : '#f1f5f9'"
              ></span>
            }
          </div>

          <!-- Indications -->
          @if (p.indications.length > 0) {
            <div
              class="mb-1.5 mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"
            >
              Indications · {{ p.indications.length }}
            </div>
            <div class="flex flex-wrap gap-1.5">
              @for (ind of indicationPreview(); track ind.id) {
                <span
                  class="inline-flex items-center gap-1.5 border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700"
                >
                  <span class="h-[5px] w-[5px] shrink-0 bg-slate-400" aria-hidden="true"></span>
                  {{ ind.abbreviation ?? ind.name }}
                </span>
              }
              @if (hiddenIndications() > 0) {
                <span class="self-center font-mono text-[10px] text-slate-400"
                  >+{{ hiddenIndications() }}</span
                >
              }
            </div>
          }

          <!-- Signal chips: the chart's activity + intelligence rings rendered
               inline as labeled chips. Multi-spoke is already carried by the
               header dot and the "Indications · N spokes" label, so it is not
               repeated here. -->
          @if (p.has_recent_activity || p.intelligence_count > 0) {
            <div class="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
              @if (p.has_recent_activity) {
                <span
                  class="inline-flex items-center gap-1.5 border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.04em] text-amber-800"
                >
                  <span
                    class="h-[10px] w-[10px] shrink-0 rounded-full border-2 border-amber-500"
                    aria-hidden="true"
                  ></span>
                  {{ recentChangeLabel(p.recent_changes_count, p.most_recent_change_type) }}
                </span>
              }
              @if (p.intelligence_count > 0) {
                <span
                  class="inline-flex items-center gap-1.5 border border-brand-200 bg-brand-50 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.04em] text-brand-700"
                >
                  <span
                    class="h-[10px] w-[10px] shrink-0 rounded-full border-2 border-brand-600"
                    aria-hidden="true"
                  ></span>
                  {{ p.intelligence_count }} {{ p.intelligence_count === 1 ? 'note' : 'notes' }}
                </span>
              }
            </div>
          }

          <!-- Meta line -->
          <div class="mt-3 text-[12px] text-slate-700">
            @if (moaList().length > 0) {
              <span class="font-semibold text-slate-900">{{ moaList().join(', ') }}</span>
              <span class="text-slate-300"> · </span>
            }
            {{ p.trials.length }} {{ p.trials.length === 1 ? 'trial' : 'trials' }}
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BullseyeTooltipComponent {
  readonly product = input<BullseyeAsset | null>(null);
  readonly x = input<number>(0);
  readonly y = input<number>(0);
  readonly spokeCount = input<number>(0);
  /** Whether the space tracks preclinical; narrows the phase ladder. */
  readonly showPreclinical = input<boolean>(true);

  private readonly indicationCap = 3;

  /**
   * Place the tooltip beside the cursor rather than centered above it, so it
   * never lands on the chart: when the cursor is in the left half of the
   * viewport the tooltip sits to its right, otherwise to its left. The vertical
   * anchor is centered on the cursor and clamped so the card stays on-screen.
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
      top: Math.min(Math.max(y, 130), vh - 130),
      transform: placeRight ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
    };
  });

  /**
   * Concentric signal rings for the header mark, faithful to the bullseye
   * PhaseDot: orange for recent activity, brand for attached intelligence,
   * dashed slate for an asset that appears on multiple spokes. Rings step
   * outward from the phase-colored core (size 30 geometry: core r=4.5,
   * step=3.45). Colors are fixed chart-mark colors, never whitelabeled --
   * except the intel ring, which echoes the brand legend treatment.
   */
  protected readonly dotRings = computed<
    { kind: string; r: number; stroke: string; width: number; dash: string | null }[]
  >(() => {
    const p = this.product();
    if (!p) return [];
    const rings: { kind: string; r: number; stroke: string; width: number; dash: string | null }[] =
      [];
    let r = 4.5 + 3.45;
    if (p.has_recent_activity) {
      rings.push({ kind: 'activity', r, stroke: '#f97316', width: 2.1, dash: null });
      r += 3.45;
    }
    if (p.intelligence_count > 0) {
      rings.push({ kind: 'intel', r, stroke: 'var(--brand-600)', width: 2.1, dash: null });
      r += 3.45;
    }
    if (this.spokeCount() > 1) {
      rings.push({ kind: 'spokes', r, stroke: '#94a3b8', width: 1.5, dash: '1.5 1.5' });
      r += 3.45;
    }
    return rings;
  });

  readonly moaList = computed<string[]>(() => {
    const p = this.product();
    if (!p) return [];
    return p.moas.map((m) => m.name);
  });

  protected readonly indicationPreview = computed(() => {
    const p = this.product();
    if (!p) return [];
    return p.indications.slice(0, this.indicationCap);
  });

  protected readonly hiddenIndications = computed(() => {
    const p = this.product();
    if (!p) return 0;
    return Math.max(0, p.indications.length - this.indicationCap);
  });

  /** Segmented phase ladder up to the asset's highest reached phase. */
  protected readonly ladder = computed<LadderCell[]>(() => {
    const p = this.product();
    const order = visibleRingOrder(this.showPreclinical());
    const reachedIndex = p ? order.indexOf(p.highest_phase) : -1;
    return order.map((phase, i) => ({
      phase,
      short: phaseShortLabel(phase),
      color: PHASE_COLOR[phase] ?? '#64748b',
      reached: i <= reachedIndex,
      current: i === reachedIndex,
    }));
  });

  protected phaseLabel(p: string): string {
    return phaseShortLabel(p);
  }

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }

  protected readonly recentChangeLabel = recentChangeLabel;
}
