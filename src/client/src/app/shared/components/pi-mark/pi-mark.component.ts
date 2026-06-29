import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { BrandContextService } from '../../../core/services/brand-context.service';

/** Single source of truth for the PI bookmark shape (24x24 viewBox). */
export const BOOKMARK_PATH =
  'M6 3 h12 a1 1 0 0 1 1 1 v16 l-7 -4 -7 4 v-16 a1 1 0 0 1 1 -1 z';
export const PI_MARK_VIEWBOX = '0 0 24 24';

/**
 * The primary-intelligence presence glyph: a brand-filled bookmark with a
 * mandatory white outline. The non-circular shape plus the outline carry the
 * signal independent of hue, so it never collides with circular markers,
 * node dots, the activity ring, or same-hue phase tints. Static by design;
 * motion is reserved for the activity signal.
 */
@Component({
  selector: 'app-pi-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      role="img"
      [attr.aria-label]="effectiveLabel()"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      class="inline-block shrink-0 align-[-0.125em]"
    >
      <path
        [attr.d]="path"
        fill="var(--brand-600)"
        stroke="#ffffff"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  `,
})
export class PiMarkComponent {
  private readonly brand = inject(BrandContextService);

  readonly size = input<number>(11);
  /** Override the aria-label; defaults to "Has {Agency} intelligence". */
  readonly label = input<string | undefined>(undefined);
  protected readonly effectiveLabel = computed(
    () => this.label() ?? `Has ${this.brand.intelligenceLabel()}`,
  );
  protected readonly path = BOOKMARK_PATH;
  protected readonly viewBox = PI_MARK_VIEWBOX;
}
