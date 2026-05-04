import { Component, computed, input } from '@angular/core';

export type PillTone = 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'brand';

/**
 * Status / projection / priority pill primitive. One source of truth for
 * pill padding, radius, font weight, and the tone-to-color mapping.
 *
 * Use `showDot=true` (default) for status pills with a leading colored dot
 * (e.g. "Confirmed actual", "Projected · Stout estimate", "High priority").
 * Use `showDot=false` for compact tags or activity badges.
 */
@Component({
  selector: 'app-detail-panel-pill',
  standalone: true,
  template: `
    <span
      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      [class]="bgTextClass()"
    >
      @if (showDot()) {
        <span class="h-1.5 w-1.5 rounded-full" [class]="dotClass()"></span>
      }
      <ng-content />
    </span>
  `,
})
export class DetailPanelPillComponent {
  readonly tone = input<PillTone>('slate');
  readonly showDot = input<boolean>(true);

  // Tailwind classes are kept as literal string lookups so the JIT scanner
  // picks them up. Do not interpolate dynamic class fragments here.
  private static readonly TONE_BG_TEXT: Record<PillTone, string> = {
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700',
    brand: 'bg-brand-50 text-brand-700',
  };

  private static readonly TONE_DOT: Record<PillTone, string> = {
    green: 'bg-green-600',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    slate: 'bg-slate-400',
    blue: 'bg-blue-500',
    brand: 'bg-brand-500',
  };

  protected readonly bgTextClass = computed(
    () => DetailPanelPillComponent.TONE_BG_TEXT[this.tone()]
  );

  protected readonly dotClass = computed(() => DetailPanelPillComponent.TONE_DOT[this.tone()]);
}
