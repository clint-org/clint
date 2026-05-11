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
import { CtgovSourceTagComponent } from '../../../shared/components/ctgov-source-tag.component';
import { DiamondIconComponent } from '../../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../../shared/components/svg-icons/flag-icon.component';
import { TriangleIconComponent } from '../../../shared/components/svg-icons/triangle-icon.component';
import { SquareIconComponent } from '../../../shared/components/svg-icons/square-icon.component';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';

@Component({
  selector: 'app-marker-tooltip',
  standalone: true,
  imports: [
    CircleIconComponent,
    CtgovSourceTagComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  template: `
    <div
      class="fixed pointer-events-none overflow-hidden flex rounded-lg bg-white border border-slate-200 shadow-[0_4px_16px_rgba(15,23,42,0.08),_0_1px_3px_rgba(15,23,42,0.04)]"
      [style.z-index]="99999"
      [style.left.px]="tooltipX()"
      [style.top.px]="tooltipY()"
      [style.min-width]="'200px'"
      [style.max-width]="'300px'"
      [style.transform]="flipAbove() ? 'translate(-50%, -100%)' : 'translateX(-50%)'"
    >
      <!-- Left accent bar -->
      <div class="shrink-0 w-[3px]" [style.background]="typeColor()"></div>

      <!-- Content -->
      <div class="px-3 py-2.5 flex-1 min-w-0">
        <!-- Category tag -->
        @if (categoryName()) {
          <div class="mb-1.5">
            <span class="text-[10px] uppercase tracking-wider text-slate-400">{{
              categoryName()
            }}</span>
          </div>
        }

        <!-- Title -->
        <div class="text-[12px] font-semibold text-slate-900 leading-snug mb-1.5">
          <span>{{ title() }}</span>
          <app-ctgov-source-tag class="ml-1.5 align-middle" [metadata]="metadata()" />
        </div>

        <!-- Type icon + name | date row -->
        <div class="flex items-center gap-1.5 mb-1.5">
          <!-- Marker shape icon -->
          <svg width="10" height="10" class="shrink-0 overflow-visible">
            @switch (shape()) {
              @case ('circle') {
                <g
                  app-circle-icon
                  [size]="10"
                  [color]="typeColor()"
                  [fillStyle]="typedFillStyle()"
                  [innerMark]="typedInnerMark()"
                />
              }
              @case ('diamond') {
                <g
                  app-diamond-icon
                  [size]="10"
                  [color]="typeColor()"
                  [fillStyle]="typedFillStyle()"
                  [innerMark]="typedInnerMark()"
                />
              }
              @case ('flag') {
                <g app-flag-icon [size]="10" [color]="typeColor()" [fillStyle]="typedFillStyle()" />
              }
              @case ('triangle') {
                <g
                  app-triangle-icon
                  [size]="10"
                  [color]="typeColor()"
                  [fillStyle]="typedFillStyle()"
                />
              }
              @case ('square') {
                <g
                  app-square-icon
                  [size]="10"
                  [color]="typeColor()"
                  [fillStyle]="typedFillStyle()"
                  [innerMark]="typedInnerMark()"
                />
              }
              @default {
                <g
                  app-circle-icon
                  [size]="10"
                  [color]="typeColor()"
                  [fillStyle]="typedFillStyle()"
                  [innerMark]="typedInnerMark()"
                />
              }
            }
          </svg>
          <span class="text-[11px] text-slate-600">{{ typeName() }}</span>
          <span class="text-[11px] text-slate-300 select-none">|</span>
          <span class="text-[11px] text-slate-400 font-mono">{{ formattedDate() }}</span>
        </div>

        <!-- Projection badge -->
        @if (projectionLabel()) {
          <div class="mb-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5">
            <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
            <span class="text-[10px] font-medium text-amber-700">{{ projectionLabel() }}</span>
          </div>
        }
        @if (noLongerExpected()) {
          <div class="mb-1.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
            <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
            <span class="text-[10px] font-medium text-slate-500">No longer expected</span>
          </div>
        }

        <!-- Trial context -->
        @if (trialName()) {
          <div class="border-t border-slate-100 pt-2 mt-2">
            <div class="text-[10px] font-medium text-slate-900 leading-snug">{{ trialName() }}</div>
            @if (trialContext()) {
              <div class="text-[9px] text-slate-500 mt-0.5">
                {{ trialContext() }}
              </div>
            }
          </div>
        }

        <!-- Asset context -->
        @if (companyName()) {
          <div class="mt-1.5">
            <span class="text-[9px] text-slate-500 tracking-[0.03em]">
              <span class="uppercase">{{ companyName() }}</span>
              @if (assetName()) {
                · {{ assetName() }}
              }
            </span>
          </div>
        }

        <!-- Description -->
        @if (description()) {
          <p class="text-[11px] text-slate-500 leading-relaxed mt-1.5">{{ description() }}</p>
        }

        <!-- Primary intelligence reference -->
        @if (intelligenceHeadline()) {
          <div class="mt-2 border-t border-slate-100 pt-2">
            <p class="text-[9px] font-semibold uppercase tracking-wider text-brand-700">
              Primary intelligence
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
            class="pointer-events-auto mt-2 block text-brand-600 text-xs hover:text-brand-700 hover:underline"
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
  readonly assetName = input<string>('');

  /**
   * Optional primary-intelligence headline to surface on the tooltip.
   * The grid hosts this only when the marker has a published read; the
   * tooltip stays lean and does not query for the read itself.
   */
  readonly intelligenceHeadline = input<string | null>(null);

  readonly tooltipX = signal(0);
  readonly tooltipY = signal(0);
  readonly flipAbove = signal(false);

  readonly typedFillStyle = computed<FillStyle>(() => (this.fillStyle() as FillStyle) ?? 'filled');
  readonly typedInnerMark = computed<InnerMark>(() => (this.innerMark() as InnerMark) ?? 'none');

  readonly trialContext = computed(() =>
    [this.trialPhase(), this.recruitmentStatus()].filter((v) => !!v).join(' \u00b7 ')
  );

  readonly formattedDate = computed(() => {
    if (!this.date()) return '';
    const d = new Date(this.date());
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  readonly projectionLabel = computed(() => {
    switch (this.projection()) {
      case 'stout':
        return 'Stout estimate';
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
