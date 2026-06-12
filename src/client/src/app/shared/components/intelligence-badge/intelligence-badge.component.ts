import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { PLATFORM_OPERATOR } from '../../../core/models/legal-content';
import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../clint-mark';

/**
 * Sub-brand lockup for AI-powered surfaces: "Clint Intelligence". The AI
 * engine is the platform operator's capability, not the tenant's product, so
 * this badge is always Clint (PLATFORM_OPERATOR) in Clint teal, never the host
 * brand name or color, even on whitelabel hosts. (The generic app-loader is
 * likewise drawn in the Clint logo teal -- the loading mark is a Clint
 * signature, not host-tinted brand chrome.)
 * At rest the mark is static at full strength. While the AI is actively
 * working (active=true) the mark runs the draw-through animation, so the
 * badge doubles as the loading indicator for the surface it signs.
 */
@Component({
  selector: 'app-intelligence-badge',
  template: `
    <svg width="16" height="16" [attr.viewBox]="viewBox" fill="none" aria-hidden="true">
      <polyline
        [class.clint-mark-track]="active()"
        [attr.points]="points.outer"
        stroke="#cbd5e1"
        [attr.stroke-width]="strokes.outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [class.clint-mark-track]="active()"
        [attr.points]="points.middle"
        stroke="#94a3b8"
        [attr.stroke-width]="strokes.middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [class.clint-mark-track]="active()"
        [attr.points]="points.inner"
        stroke="#0d9488"
        [attr.stroke-width]="strokes.inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      @if (active()) {
        <polyline
          class="clint-mark-draw"
          pathLength="1"
          [attr.points]="points.outer"
          stroke="#cbd5e1"
          [attr.stroke-width]="strokes.outer"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          class="clint-mark-draw clint-mark-draw--m"
          pathLength="1"
          [attr.points]="points.middle"
          stroke="#94a3b8"
          [attr.stroke-width]="strokes.middle"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          class="clint-mark-draw clint-mark-draw--i"
          pathLength="1"
          [attr.points]="points.inner"
          stroke="#0d9488"
          [attr.stroke-width]="strokes.inner"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      }
    </svg>
    <span class="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">
      {{ platform }} <span class="text-[#0d9488]">Intelligence</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceBadgeComponent {
  /** True while the AI is actively working; animates the mark. */
  readonly active = input<boolean>(false);

  /** Always "Clint": the AI engine is the platform operator's capability. */
  protected readonly platform = PLATFORM_OPERATOR;
  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;
  protected readonly strokes = clintMarkStrokes(16);
}
