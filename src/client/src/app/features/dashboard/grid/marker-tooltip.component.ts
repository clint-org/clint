import { Component, computed, ElementRef, inject, input, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-marker-tooltip',
  standalone: true,
  template: `
    <div
      class="absolute z-50 rounded-lg bg-slate-900 shadow-xl overflow-hidden"
      [style.left]="'50%'"
      [style.transform]="'translateX(-50%)'"
      [style.min-width]="'200px'"
      [style.max-width]="'300px'"
      [class.bottom-full]="!showBelow()"
      [class.top-full]="showBelow()"
      [style.margin-bottom]="showBelow() ? '0' : '12px'"
      [style.margin-top]="showBelow() ? '12px' : '0'"
    >
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
          <img
            [src]="imageUrl()"
            [alt]="text()"
            class="mt-2 h-20 w-full rounded object-cover"
          />
        }
      </div>

      <!-- Arrow pointing down (tooltip above) -->
      @if (!showBelow()) {
        <div
          class="absolute left-1/2 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-slate-900"
          style="top: 100%;"
        ></div>
      }
      <!-- Arrow pointing up (tooltip below) -->
      @if (showBelow()) {
        <div
          class="absolute left-1/2 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-slate-900"
          style="bottom: 100%;"
        ></div>
      }
    </div>
  `,
})
export class MarkerTooltipComponent implements OnInit {
  private el = inject(ElementRef);

  text = input.required<string>();
  typeName = input.required<string>();
  typeColor = input.required<string>();
  date = input.required<string>();
  isProjected = input.required<boolean>();
  imageUrl = input<string | null>(null);

  showBelow = signal(false);

  formattedDate = computed(() => {
    if (!this.date()) return '';
    const d = new Date(this.date());
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  ngOnInit(): void {
    const rect = this.el.nativeElement.getBoundingClientRect();
    if (rect.top < 160) {
      this.showBelow.set(true);
    }
  }
}
