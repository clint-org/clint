import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';
import { GLYPH_RATIOS, GLYPH_STROKES } from '../../../core/models/marker-visual';

@Component({
  selector: 'g[app-circle-icon]',
  standalone: true,
  template: `
    <svg:circle
      [attr.cx]="size() / 2"
      [attr.cy]="size() / 2"
      [attr.r]="size() / 2 - 1"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="S.shape"
      [attr.stroke-dasharray]="outlineDash() ? dashPattern : null"
    />
    @if (innerMark() === 'dot') {
      <svg:circle
        [attr.cx]="size() / 2"
        [attr.cy]="size() / 2"
        [attr.r]="size() * R.innerDotR"
        [attr.fill]="markColor()"
      />
    }
    @if (innerMark() === 'dash') {
      <svg:line
        [attr.x1]="size() * R.circleDashX1"
        [attr.y1]="size() / 2"
        [attr.x2]="size() * R.circleDashX2"
        [attr.y2]="size() / 2"
        [attr.stroke]="markColor()"
        [attr.stroke-width]="S.innerMark"
        stroke-linecap="round"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CircleIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');
  readonly innerMark = input<InnerMark>('none');
  readonly outlineDash = input<boolean>(false);

  protected readonly R = GLYPH_RATIOS;
  protected readonly S = GLYPH_STROKES;
  protected readonly dashPattern = GLYPH_STROKES.outlineDashPattern.join(',');

  readonly markColor = computed(() => (this.fillStyle() === 'outline' ? this.color() : 'white'));
}
