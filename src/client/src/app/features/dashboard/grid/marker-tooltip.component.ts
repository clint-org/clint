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

@Component({
  selector: 'app-marker-tooltip',
  standalone: true,
  template: `
    <div
      class="fixed rounded-lg bg-slate-900 shadow-xl overflow-hidden pointer-events-none"
      [style.z-index]="99999"
      [style.left.px]="tooltipX()"
      [style.top.px]="tooltipY()"
      [style.min-width]="'200px'"
      [style.max-width]="'300px'"
      [style.transform]="flipAbove() ? 'translate(-50%, -100%)' : 'translateX(-50%)'"
    >
      <!-- Arrow -->
      @if (flipAbove()) {
        <div
          class="absolute left-1/2 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-slate-900"
          style="top: 100%;"
        ></div>
      } @else {
        <div
          class="absolute left-1/2 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-slate-900"
          style="bottom: 100%;"
        ></div>
      }

      <!-- Colored accent bar -->
      <div class="h-1" [style.background]="typeColor()"></div>

      <div class="px-3 py-2.5">
        <!-- Category tag -->
        @if (categoryName()) {
          <div class="mb-1.5">
            <span class="text-[10px] uppercase tracking-wider text-slate-500">{{ categoryName() }}</span>
          </div>
        }

        <!-- Title -->
        <div class="text-[12px] font-semibold text-white leading-snug mb-1.5">{{ title() }}</div>

        <!-- Type name with colored dot -->
        <div class="flex items-center gap-1.5 mb-1">
          <span class="h-2 w-2 rounded-full shrink-0" [style.background]="typeColor()"></span>
          <span class="text-[11px] text-slate-300">{{ typeName() }}</span>
        </div>

        <!-- Date -->
        <div class="text-[11px] text-slate-400 font-mono mb-1.5">{{ formattedDate() }}</div>

        <!-- Projection badge -->
        @if (projectionLabel()) {
          <div class="mb-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5">
            <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
            <span class="text-[10px] font-medium text-amber-300">{{ projectionLabel() }}</span>
          </div>
        }

        <!-- Description -->
        @if (description()) {
          <p class="text-[11px] text-slate-300 leading-relaxed mt-1">{{ description() }}</p>
        }

        <!-- Source URL -->
        @if (sourceUrl()) {
          <a
            [href]="sourceUrl()!"
            target="_blank"
            rel="noopener noreferrer"
            class="pointer-events-auto mt-2 block text-teal-400 text-xs hover:underline"
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

  tooltipX = signal(0);
  tooltipY = signal(0);
  flipAbove = signal(false);

  formattedDate = computed(() => {
    if (!this.date()) return '';
    const d = new Date(this.date());
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  projectionLabel = computed(() => {
    switch (this.projection()) {
      case 'stout':
        return 'Stout';
      case 'company':
        return 'Company';
      case 'primary':
        return 'Primary';
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
