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
      [style.transform]="'translateX(-50%)'"
    >
      <!-- Arrow pointing up -->
      <div
        class="absolute left-1/2 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-slate-900"
        style="bottom: 100%;"
      ></div>

      <!-- Colored accent bar -->
      <div class="h-1" [style.background]="typeColor()"></div>

      <div class="px-3 py-2.5">
        <!-- Type name with colored dot -->
        <div class="flex items-center gap-1.5 mb-1">
          <span class="h-2 w-2 rounded-full shrink-0" [style.background]="typeColor()"></span>
          <span class="text-[11px] font-semibold text-white">{{ typeName() }}</span>
        </div>

        <!-- Date -->
        <div class="text-[11px] text-slate-400 font-mono mb-1.5">{{ formattedDate() }}</div>

        <!-- Description -->
        @if (text()) {
          <p class="text-[11px] text-slate-300 leading-relaxed">{{ text() }}</p>
        }

        <!-- Projected badge -->
        @if (isProjected()) {
          <div class="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5">
            <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
            <span class="text-[10px] font-medium text-amber-300">Projected</span>
          </div>
        }

        <!-- Image -->
        @if (imageUrl()) {
          <img [src]="imageUrl()" [alt]="text()" class="mt-2 h-20 w-full rounded object-cover" />
        }
      </div>
    </div>
  `,
})
export class MarkerTooltipComponent implements AfterViewInit {
  private el = inject(ElementRef);
  private cdr = inject(ChangeDetectorRef);

  text = input.required<string>();
  typeName = input.required<string>();
  typeColor = input.required<string>();
  date = input.required<string>();
  isProjected = input.required<boolean>();
  imageUrl = input<string | null>(null);

  tooltipX = signal(0);
  tooltipY = signal(0);

  formattedDate = computed(() => {
    if (!this.date()) return '';
    const d = new Date(this.date());
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  ngAfterViewInit(): void {
    const markerEl = this.el.nativeElement.closest('[role="button"]');
    if (markerEl) {
      const rect = markerEl.getBoundingClientRect();
      this.tooltipX.set(rect.left + rect.width / 2);
      this.tooltipY.set(rect.bottom + 8);
      this.cdr.detectChanges();
    }
  }
}
