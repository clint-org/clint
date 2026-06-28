import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { GLYPH_STROKES } from '../../../core/models/marker-visual';
import { FillStyle, InnerMark, MarkerShape } from '../../../core/models/marker.model';
import { CircleIconComponent } from './circle-icon.component';
import { DiamondIconComponent } from './diamond-icon.component';
import { FlagIconComponent } from './flag-icon.component';
import { HexagonIconComponent } from './hexagon-icon.component';
import { NleOverlayComponent } from './nle-overlay.component';
import { SquareIconComponent } from './square-icon.component';
import { TriangleIconComponent } from './triangle-icon.component';

/**
 * Single source of truth for marker visuals. Renders the per-shape SVG icon
 * with the same fill/inner-mark/NLE rules used on the timeline grid, so any
 * surface that shows a marker (timeline, catalyst table, bullseye recent
 * markers, marker drawer header) reads identically.
 */
@Component({
  selector: 'app-marker-icon',
  standalone: true,
  imports: [
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    HexagonIconComponent,
    NleOverlayComponent,
    SquareIconComponent,
    TriangleIconComponent,
  ],
  template: `
    @if (shape() === 'dashed-line') {
      <svg
        [attr.width]="6"
        [attr.height]="size()"
        class="overflow-visible"
        [attr.aria-hidden]="true"
      >
        <line
          x1="3"
          y1="0"
          x2="3"
          [attr.y2]="size()"
          [attr.stroke]="dashedStroke()"
          [attr.stroke-width]="S.dashedLine"
          [attr.stroke-dasharray]="dashPattern"
          stroke-linecap="round"
          [attr.opacity]="isNle() ? 0.25 : 1"
        />
      </svg>
    } @else {
      <svg
        [attr.width]="size()"
        [attr.height]="size()"
        class="overflow-visible"
        [attr.aria-hidden]="true"
      >
        <g [attr.opacity]="nleOpacity()">
          @switch (shape()) {
            @case ('circle') {
              <g
                app-circle-icon
                [size]="size()"
                [color]="color()"
                [fillStyle]="fillStyle()"
                [innerMark]="innerMark()"
              />
            }
            @case ('diamond') {
              <g
                app-diamond-icon
                [size]="size()"
                [color]="color()"
                [fillStyle]="fillStyle()"
                [innerMark]="innerMark()"
              />
            }
            @case ('flag') {
              <g app-flag-icon [size]="size()" [color]="color()" [fillStyle]="fillStyle()" />
            }
            @case ('triangle') {
              <g app-triangle-icon [size]="size()" [color]="color()" [fillStyle]="fillStyle()" />
            }
            @case ('square') {
              <g
                app-square-icon
                [size]="size()"
                [color]="color()"
                [fillStyle]="fillStyle()"
                [innerMark]="innerMark()"
              />
            }
            @case ('hexagon') {
              <g
                app-hexagon-icon
                [size]="size()"
                [color]="color()"
                [fillStyle]="fillStyle()"
                [innerMark]="innerMark()"
              />
            }
          }
        </g>
        @if (isNle()) {
          <g app-nle-overlay [size]="size()" />
        }
      </svg>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerIconComponent {
  readonly shape = input.required<MarkerShape>();
  readonly color = input.required<string>();
  readonly size = input<number>(16);
  readonly fillStyle = input<FillStyle>('filled');
  readonly innerMark = input<InnerMark>('none');
  readonly isNle = input<boolean>(false);

  protected readonly S = GLYPH_STROKES;
  protected readonly dashPattern = GLYPH_STROKES.dashedLinePattern.join(',');

  protected readonly nleOpacity = computed(() => (this.isNle() ? 0.3 : 1));

  protected readonly dashedStroke = computed(() => {
    if (this.isNle()) return this.color();
    return this.fillStyle() === 'outline' ? '#cbd5e1' : this.color();
  });
}
