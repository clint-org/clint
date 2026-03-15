import { Component, input } from '@angular/core';

@Component({
  selector: 'app-marker-tooltip',
  standalone: true,
  template: `
    <div
      class="absolute z-50 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
      style="bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; max-width: 220px;"
    >
      @if (imageUrl()) {
        <img
          [src]="imageUrl()"
          [alt]="text()"
          class="mb-1.5 h-16 w-full rounded object-cover"
        />
      }
      <p class="whitespace-normal leading-snug">{{ text() }}</p>
      <!-- Arrow -->
      <div
        class="absolute left-1/2 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-gray-900"
        style="top: 100%;"
      ></div>
    </div>
  `,
})
export class MarkerTooltipComponent {
  text = input.required<string>();
  imageUrl = input<string | null>(null);
}
