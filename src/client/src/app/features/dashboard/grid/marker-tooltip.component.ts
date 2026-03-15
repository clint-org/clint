import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-marker-tooltip',
  standalone: true,
  template: `
    <div
      class="absolute z-50 rounded-lg bg-slate-900 shadow-xl overflow-hidden"
      style="bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 12px; min-width: 200px; max-width: 300px;"
    >
      <!-- Colored top accent bar -->
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

      <!-- Arrow -->
      <div
        class="absolute left-1/2 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-slate-900"
        style="top: 100%;"
      ></div>
    </div>
  `,
})
export class MarkerTooltipComponent {
  text = input.required<string>();
  typeName = input.required<string>();
  typeColor = input.required<string>();
  date = input.required<string>();
  isProjected = input.required<boolean>();
  imageUrl = input<string | null>(null);

  formattedDate = computed(() => {
    if (!this.date()) return '';
    const d = new Date(this.date());
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });
}
