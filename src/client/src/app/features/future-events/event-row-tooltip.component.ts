import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { FlatCatalyst } from '../../core/models/event-detail.model';
import {
  ProjectionBadge,
  projectionBadge,
  projectionOutlineDash,
} from '../../core/models/marker-visual';
import { phaseShortLabel } from '../../core/models/phase-colors';
import { CompanyTileComponent } from '../../shared/components/company-tile.component';
import { MarkerIconComponent } from '../../shared/components/svg-icons/marker-icon.component';
import { fadeTooltipAnimation } from '../../shared/animations/fade-tooltip.animation';

/**
 * Catalyst row hover preview. Built from the marker primitives the Timeline
 * event tooltip uses (marker glyph, projected/confirmed pill, tabular date,
 * company tile), re-keyed to the catalyst row. Surfaces the marker summary on
 * hover so the analyst reads the catalyst's date confidence and affiliation
 * without opening the pane. All fields come from the already-loaded row.
 *
 * Placement mirrors the bullseye tooltip: the card sits beside the cursor.
 * Projection colors are the fixed amber/brand treatment, never whitelabeled.
 */
@Component({
  selector: 'app-event-row-tooltip',
  standalone: true,
  imports: [CompanyTileComponent, DatePipe, MarkerIconComponent],
  animations: [fadeTooltipAnimation],
  template: `
    @if (catalyst(); as c) {
      <div
        @fadeTooltip
        class="pointer-events-none fixed z-50 w-[320px] border border-slate-200 bg-white text-slate-700 shadow-xl"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
        [style.transform]="pos().transform"
        role="tooltip"
      >
        <!-- Header: marker glyph + category + trial acronym -->
        <div class="flex items-center gap-2 border-b border-slate-100 px-3.5 py-3">
          <app-marker-icon
            class="shrink-0"
            [shape]="c.marker_type_shape"
            [color]="c.marker_type_color"
            [size]="15"
            [fillStyle]="c.is_projected ? 'outline' : 'filled'"
            [innerMark]="c.marker_type_inner_mark"
            [isNle]="c.no_longer_expected"
            [projectionBadge]="markerBadge(c)"
            [outlineDash]="markerOutlineDash(c)"
          />
          <span
            class="min-w-0 flex-1 truncate font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500"
            >{{ c.category_name }}</span
          >
          @if (c.trial_acronym ?? c.trial_name; as trial) {
            <span class="shrink-0 truncate font-mono text-[10px] tabular-nums text-slate-300">{{
              trial
            }}</span>
          }
        </div>

        <div class="px-3.5 py-3">
          <div class="mb-3 text-[15px] font-bold leading-snug text-slate-900">{{ c.title }}</div>

          <div class="mb-3 flex items-center justify-between gap-2.5">
            <span class="font-mono text-[17px] font-bold tabular-nums text-slate-900">{{
              c.event_date | date: 'mediumDate'
            }}</span>
            <!-- Projected / Confirmed pill, matching the catalyst table status
                 cell: amber + hollow dot for projected, brand + filled dot for
                 confirmed. -->
            <span
              class="inline-flex shrink-0 items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase leading-none tracking-[0.1em]"
              [class.border-amber-200]="c.is_projected"
              [class.bg-amber-50]="c.is_projected"
              [class.text-amber-800]="c.is_projected"
              [class.border-brand-200]="!c.is_projected"
              [class.bg-brand-50]="!c.is_projected"
              [class.text-brand-700]="!c.is_projected"
            >
              <span
                class="box-border h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px]"
                [class.border-amber-700]="c.is_projected"
                [class.bg-transparent]="c.is_projected"
                [class.border-brand-700]="!c.is_projected"
                [class.bg-brand-700]="!c.is_projected"
                aria-hidden="true"
              ></span>
              {{ c.is_projected ? 'Projected' : 'Confirmed' }}
            </span>
          </div>

          @if (sourceDomain(); as domain) {
            <div class="mb-3 font-mono text-[10px] tracking-[0.04em] text-slate-500">
              Source · {{ domain }}
            </div>
          }

          @if (c.company_name) {
            <div class="flex items-center gap-2.5 border-t border-slate-100 pt-3">
              <app-company-tile
                [name]="c.company_name"
                [logoUrl]="c.company_logo_url ?? null"
                [size]="22"
              />
              <div class="min-w-0 flex-1">
                <div
                  class="truncate font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700"
                >
                  {{ c.company_name }}
                </div>
                @if (c.asset_name) {
                  <div class="mt-0.5 truncate text-[12px] text-slate-500">{{ c.asset_name }}</div>
                }
              </div>
              @if (phaseLabel(); as phase) {
                <span
                  class="shrink-0 rounded-sm bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-slate-600"
                  >{{ phase }}</span
                >
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventRowTooltipComponent {
  readonly catalyst = input<FlatCatalyst | null>(null);
  readonly x = input<number>(0);
  readonly y = input<number>(0);

  /** Projection tier badge + forecast dash, matching the timeline glyph. */
  protected markerBadge(c: FlatCatalyst): ProjectionBadge {
    return projectionBadge(c.projection);
  }

  protected markerOutlineDash(c: FlatCatalyst): boolean {
    return projectionOutlineDash(c.projection);
  }

  protected readonly phaseLabel = computed<string | null>(() => {
    const p = this.catalyst()?.trial_phase;
    return p ? phaseShortLabel(p) : null;
  });

  /**
   * Source host for the provenance line. Primary-source rule: the derived
   * CT.gov registry link wins, else the first attached citation (the order the
   * RPC returned), else the legacy source_url (mid-transition fallback).
   */
  protected readonly sourceDomain = computed<string | null>(() => {
    const c = this.catalyst();
    const url = c?.registry_url ?? c?.sources?.[0]?.url ?? c?.source_url;
    if (!url) return null;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  });

  /**
   * Place the card beside the cursor: right when the cursor is in the left
   * half of the viewport, otherwise left. Vertical anchor centered + clamped.
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
}
