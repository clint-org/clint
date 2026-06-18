import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';

/**
 * Company identity tile. Shows the company logo when a `logoUrl` is present,
 * otherwise a colored square carrying the company's initial. The initial-tile
 * background is derived deterministically from the company name so the same
 * company always reads the same color across surfaces.
 *
 * This is the shared identity treatment used by the bullseye and heatmap
 * detail panes; it mirrors the marker pane's logo affordance and adds the
 * initial fallback the marker pane lacks.
 */
@Component({
  selector: 'app-company-tile',
  standalone: true,
  imports: [NgOptimizedImage],
  template: `
    @if (logoUrl()) {
      <img
        [ngSrc]="logoUrl()!"
        [alt]="name()"
        [width]="size()"
        [height]="size()"
        class="flex-none rounded-sm border border-slate-200 bg-white object-contain"
        [style.width.px]="size()"
        [style.height.px]="size()"
      />
    } @else {
      <span
        class="flex flex-none items-center justify-center font-mono font-bold italic text-white"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.font-size.px]="fontSize()"
        [style.background-color]="background()"
        aria-hidden="true"
        >{{ initial() }}</span
      >
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyTileComponent {
  readonly name = input.required<string>();
  readonly logoUrl = input<string | null>(null);
  readonly size = input<number>(22);

  // Slate-family palette only: tinted neutrals, no color noise. The data
  // colors (marker/phase) stay reserved for clinical meaning.
  private static readonly PALETTE = [
    '#475569', // slate-600
    '#334155', // slate-700
    '#0f766e', // teal-700 (brand-adjacent neutral anchor)
    '#1e3a5f', // deep slate-blue
    '#52525b', // zinc-600
    '#3f3f46', // zinc-700
  ];

  protected readonly initial = computed(() => {
    const n = this.name().trim();
    return n ? n[0].toUpperCase() : '?';
  });

  protected readonly fontSize = computed(() => Math.round(this.size() * 0.55));

  protected readonly background = computed(() => {
    const n = this.name();
    let hash = 0;
    for (let i = 0; i < n.length; i++) {
      hash = (hash * 31 + n.charCodeAt(i)) | 0;
    }
    const palette = CompanyTileComponent.PALETTE;
    return palette[Math.abs(hash) % palette.length];
  });
}
