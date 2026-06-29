import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { CircleIconComponent } from '../../../shared/components/svg-icons/circle-icon.component';
import { CompanyTileComponent } from '../../../shared/components/company-tile.component';
import { CtgovSourceTagComponent } from '../../../shared/components/ctgov-source-tag.component';
import { DiamondIconComponent } from '../../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../../shared/components/svg-icons/flag-icon.component';
import { TriangleIconComponent } from '../../../shared/components/svg-icons/triangle-icon.component';
import { SquareIconComponent } from '../../../shared/components/svg-icons/square-icon.component';
import { DatePrecision, FillStyle, InnerMark } from '../../../core/models/marker.model';
import { markerExtentLabel, markerPeriodLabel } from '../../../core/models/marker-date-precision';
import { phaseShortLabel } from '../../../core/models/phase-colors';

@Component({
  selector: 'app-marker-tooltip',
  standalone: true,
  imports: [
    CircleIconComponent,
    CompanyTileComponent,
    CtgovSourceTagComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  template: `
    <div
      class="fixed pointer-events-none overflow-hidden bg-white border border-slate-200 shadow-[0_4px_16px_rgba(15,23,42,0.08),_0_1px_3px_rgba(15,23,42,0.04)]"
      [style.z-index]="99999"
      [style.left.px]="tooltipX()"
      [style.top.px]="tooltipY()"
      [style.min-width]="'240px'"
      [style.max-width]="'300px'"
      [style.transform]="flipAbove() ? 'translate(-50%, -100%)' : 'translateX(-50%)'"
    >
      <!-- Identity strip: glyph + category label + trial id -->
      <div class="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <svg width="12" height="12" class="shrink-0 overflow-visible">
          @switch (shape()) {
            @case ('diamond') {
              <g
                app-diamond-icon
                [size]="12"
                [color]="typeColor()"
                [fillStyle]="typedFillStyle()"
                [innerMark]="typedInnerMark()"
              />
            }
            @case ('flag') {
              <g app-flag-icon [size]="12" [color]="typeColor()" [fillStyle]="typedFillStyle()" />
            }
            @case ('triangle') {
              <g
                app-triangle-icon
                [size]="12"
                [color]="typeColor()"
                [fillStyle]="typedFillStyle()"
              />
            }
            @case ('square') {
              <g
                app-square-icon
                [size]="12"
                [color]="typeColor()"
                [fillStyle]="typedFillStyle()"
                [innerMark]="typedInnerMark()"
              />
            }
            @default {
              <g
                app-circle-icon
                [size]="12"
                [color]="typeColor()"
                [fillStyle]="typedFillStyle()"
                [innerMark]="typedInnerMark()"
              />
            }
          }
        </svg>
        <span
          class="min-w-0 flex-1 truncate font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500"
        >
          @if (categoryName() && typeName()) {
            {{ categoryName() }} · {{ typeName() }}
          } @else {
            {{ categoryName() || typeName() }}
          }
        </span>
        @if (trialName()) {
          <span
            class="shrink-0 font-mono text-[9px] uppercase tracking-wide text-slate-400 tabular-nums"
            >{{ trialName() }}</span
          >
        }
      </div>

      <div class="px-3.5 py-3">
        <!-- Title -->
        <div class="mb-3 text-[12px] font-semibold leading-snug text-slate-900">
          <span>{{ title() }}</span>
          <app-ctgov-source-tag class="ml-1.5 align-middle" [metadata]="metadata()" />
        </div>

        <!-- Focal row: date + status tag -->
        <div class="mb-3 flex items-center justify-between gap-2.5">
          <span class="font-mono text-[14px] font-bold tabular-nums text-slate-900">{{
            formattedDate()
          }}</span>
          @if (noLongerExpected()) {
            <span
              class="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider leading-none text-slate-600"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
              No longer expected
            </span>
          } @else {
            <span
              class="inline-flex items-center gap-1.5 border px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider leading-none"
              [class.bg-amber-50]="isProjected()"
              [class.border-amber-200]="isProjected()"
              [class.text-amber-800]="isProjected()"
              [class.bg-brand-50]="!isProjected()"
              [class.border-brand-200]="!isProjected()"
              [class.text-brand-700]="!isProjected()"
            >
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full border-[1.5px] box-border"
                [class.border-amber-500]="isProjected()"
                [class.bg-transparent]="isProjected()"
                [class.border-brand-600]="!isProjected()"
                [class.bg-brand-600]="!isProjected()"
              ></span>
              {{ statusTagLabel() }}
            </span>
          }
        </div>

        <!-- Source line -->
        @if (projectionLabel()) {
          <div class="mb-3 font-mono text-[10px] tracking-[0.04em] text-slate-400">
            Source · {{ projectionLabel() }}
          </div>
        }

        <!-- Footer meta: company tile + company / asset + phase chip -->
        @if (companyName()) {
          <div class="flex items-center gap-2 border-t border-slate-100 pt-2.5">
            <app-company-tile [name]="companyName()" [logoUrl]="companyLogoUrl()" [size]="20" />
            <div class="min-w-0 flex-1">
              <div
                class="truncate font-mono text-[10px] font-bold uppercase tracking-widest text-slate-700"
              >
                {{ companyName() }}
              </div>
              @if (assetName()) {
                <div class="truncate text-[11px] text-slate-500">{{ assetName() }}</div>
              }
            </div>
            @if (phaseChipLabel()) {
              <span
                class="shrink-0 border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-slate-600"
                >{{ phaseChipLabel() }}</span
              >
            }
          </div>
        }

        <!-- Description -->
        @if (description()) {
          <p class="mt-2 text-[11px] leading-relaxed text-slate-500">{{ description() }}</p>
        }

        <!-- Primary intelligence reference -->
        @if (intelligenceHeadline()) {
          <div class="mt-2 border-t border-slate-100 pt-2">
            <p class="text-[9px] font-semibold uppercase tracking-wider text-brand-700">
              Intelligence
            </p>
            <p class="mt-0.5 text-[11px] leading-snug text-slate-700">
              {{ intelligenceHeadline() }}
            </p>
          </div>
        }

        <!-- Source URL -->
        @if (sourceUrl()) {
          <a
            [href]="sourceUrl()!"
            target="_blank"
            rel="noopener noreferrer"
            class="pointer-events-auto mt-2 block text-xs text-brand-600 hover:text-brand-700 hover:underline"
            >View source</a
          >
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerTooltipComponent implements AfterViewInit {
  private el = inject(ElementRef);
  private cdr = inject(ChangeDetectorRef);

  readonly title = input.required<string>();
  readonly typeName = input.required<string>();
  readonly typeColor = input.required<string>();
  readonly date = input.required<string>();
  readonly datePrecision = input<DatePrecision>('exact');
  readonly endDate = input<string | null>(null);
  readonly endDatePrecision = input<DatePrecision>('exact');
  readonly isOngoing = input<boolean>(false);
  readonly projection = input<string>('actual');
  readonly categoryName = input<string>('');
  readonly description = input<string | null>(null);
  readonly sourceUrl = input<string | null>(null);
  readonly metadata = input<Record<string, unknown> | null>(null);
  readonly noLongerExpected = input<boolean>(false);

  readonly shape = input<string>('');
  readonly fillStyle = input<string>('filled');
  readonly innerMark = input<string>('none');

  readonly trialName = input<string>('');
  readonly trialPhase = input<string>('');
  readonly recruitmentStatus = input<string>('');
  readonly companyName = input<string>('');
  /** Owning company's logo for the footer tile; falls back to an initial tile. */
  readonly companyLogoUrl = input<string | null>(null);
  readonly assetName = input<string>('');

  /**
   * Optional primary-intelligence headline to surface on the tooltip.
   * The grid hosts this only when the marker has published intelligence; the
   * tooltip stays lean and does not query for the intelligence itself.
   */
  readonly intelligenceHeadline = input<string | null>(null);

  readonly tooltipX = signal(0);
  readonly tooltipY = signal(0);
  readonly flipAbove = signal(false);

  readonly typedFillStyle = computed<FillStyle>(() => (this.fillStyle() as FillStyle) ?? 'filled');
  readonly typedInnerMark = computed<InnerMark>(() => (this.innerMark() as InnerMark) ?? 'none');

  /** Whether the marker's date is an estimate (any non-actual projection). */
  readonly isProjected = computed(() => this.projection() !== 'actual');

  /** Compact status tag wording on the focal row. */
  readonly statusTagLabel = computed(() => (this.isProjected() ? 'Projected' : 'Confirmed'));

  /** Short phase label (P1..P4) for the footer chip; empty when no phase. */
  readonly phaseChipLabel = computed(() => {
    const p = this.trialPhase();
    return p ? phaseShortLabel(p) : '';
  });

  private formatPoint(iso: string, precision: DatePrecision): string {
    const period = markerPeriodLabel(iso, precision);
    if (period) return period;
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  readonly formattedDate = computed(() => {
    if (!this.date()) return '';
    const start = this.formatPoint(this.date(), this.datePrecision());
    const end = this.endDate();
    if (this.isOngoing() || end) {
      return markerExtentLabel(
        start,
        end ? this.formatPoint(end, this.endDatePrecision()) : null,
        this.isOngoing()
      );
    }
    // Point marker: flag an approximate single date.
    return markerPeriodLabel(this.date(), this.datePrecision()) ? `${start} (estimated)` : start;
  });

  readonly projectionLabel = computed(() => {
    switch (this.projection()) {
      case 'estimate':
        return 'Estimate';
      case 'company':
        return 'Company guidance';
      case 'primary':
        return 'Primary source estimate';
      case 'actual':
      default:
        return '';
    }
  });

  ngAfterViewInit(): void {
    const markerEl = this.el.nativeElement.closest('[role="button"]');
    if (markerEl) {
      const rect = markerEl.getBoundingClientRect();
      const tooltipWidth = 250; // approximate mid-point of min/max width
      const margin = 12;

      // Horizontal: clamp to viewport
      let x = rect.left + rect.width / 2;
      const minX = tooltipWidth / 2 + margin;
      const maxX = window.innerWidth - tooltipWidth / 2 - margin;
      x = Math.max(minX, Math.min(maxX, x));

      // Vertical: flip above if near bottom
      let y = rect.bottom + 8;
      if (y + 150 > window.innerHeight) {
        y = rect.top - 8;
        this.flipAbove.set(true);
      }

      this.tooltipX.set(x);
      this.tooltipY.set(y);
      this.cdr.detectChanges();
    }
  }
}
