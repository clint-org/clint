import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  AfterViewInit,
  signal,
  ChangeDetectorRef,
} from '@angular/core';
import { CircleIconComponent } from '../../../shared/components/svg-icons/circle-icon.component';
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
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  template: `
    <div
      class="fixed pointer-events-none overflow-hidden"
      style="border-radius: 8px; background: white; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(15,23,42,0.08), 0 1px 3px rgba(15,23,42,0.04); display: flex;"
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
            <span class="text-[10px] uppercase tracking-wider text-slate-400">{{ categoryName() }}</span>
          </div>
        }

        <!-- Title -->
        <div class="text-[12px] font-semibold text-slate-900 leading-snug mb-1.5">{{ title() }}</div>

        <!-- Type icon + name | date row -->
        <div class="flex items-center gap-1.5 mb-1.5">
          <!-- Marker shape icon -->
          <svg width="10" height="10" class="shrink-0 overflow-visible">
            @switch (shape()) {
              @case ('circle') {
                <g app-circle-icon [size]="10" [color]="typeColor()" [fillStyle]="typedFillStyle()" [innerMark]="typedInnerMark()" />
              }
              @case ('diamond') {
                <g app-diamond-icon [size]="10" [color]="typeColor()" [fillStyle]="typedFillStyle()" [innerMark]="typedInnerMark()" />
              }
              @case ('flag') {
                <g app-flag-icon [size]="10" [color]="typeColor()" [fillStyle]="typedFillStyle()" />
              }
              @case ('triangle') {
                <g app-triangle-icon [size]="10" [color]="typeColor()" [fillStyle]="typedFillStyle()" />
              }
              @case ('square') {
                <g app-square-icon [size]="10" [color]="typeColor()" [fillStyle]="typedFillStyle()" [innerMark]="typedInnerMark()" />
              }
              @default {
                <g app-circle-icon [size]="10" [color]="typeColor()" [fillStyle]="typedFillStyle()" [innerMark]="typedInnerMark()" />
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

        <!-- Program context -->
        @if (companyName()) {
          <div class="mt-1.5">
            <span class="text-[9px] text-slate-500 tracking-[0.03em]">
              <span class="uppercase">{{ companyName() }}</span>@if (productName()) { · {{ productName() }}}
            </span>
          </div>
        }

        <!-- Description -->
        @if (description()) {
          <p class="text-[11px] text-slate-500 leading-relaxed mt-1.5">{{ description() }}</p>
        }

        <!-- Source URL -->
        @if (sourceUrl()) {
          <a
            [href]="sourceUrl()!"
            target="_blank"
            rel="noopener noreferrer"
            class="pointer-events-auto mt-2 block text-teal-600 text-xs hover:text-teal-700 hover:underline"
          >View source</a>
        }
      </div>
    </div>
  `,
})
export class MarkerTooltipComponent implements AfterViewInit {
  private el = inject(ElementRef);
  private cdr = inject(ChangeDetectorRef);

  title = input.required<string>();
  typeName = input.required<string>();
  typeColor = input.required<string>();
  date = input.required<string>();
  projection = input<string>('actual');
  categoryName = input<string>('');
  description = input<string | null>(null);
  sourceUrl = input<string | null>(null);
  noLongerExpected = input<boolean>(false);

  shape = input<string>('');
  fillStyle = input<string>('filled');
  innerMark = input<string>('none');

  trialName = input<string>('');
  trialPhase = input<string>('');
  recruitmentStatus = input<string>('');
  companyName = input<string>('');
  productName = input<string>('');

  tooltipX = signal(0);
  tooltipY = signal(0);
  flipAbove = signal(false);

  typedFillStyle = computed<FillStyle>(() => (this.fillStyle() as FillStyle) ?? 'filled');
  typedInnerMark = computed<InnerMark>(() => (this.innerMark() as InnerMark) ?? 'none');

  trialContext = computed(() =>
    [this.trialPhase(), this.recruitmentStatus()].filter(v => !!v).join(' \u00b7 ')
  );

  formattedDate = computed(() => {
    if (!this.date()) return '';
    const d = new Date(this.date());
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  projectionLabel = computed(() => {
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
