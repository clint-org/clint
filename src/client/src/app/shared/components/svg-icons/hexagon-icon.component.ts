import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';
import { GLYPH_RATIOS, GLYPH_STROKES } from '../../../core/models/marker-visual';

@Component({
  selector: 'g[app-hexagon-icon]',
  standalone: true,
  template: `
    <svg:polygon
      [attr.points]="hexagonPoints()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="S.shape"
      [attr.stroke-dasharray]="outlineDash() ? dashPattern : null"
      stroke-linejoin="round"
    />
    @if (innerMark() === 'dot') {
      <svg:circle
        [attr.cx]="size() / 2"
        [attr.cy]="size() / 2"
        [attr.r]="size() * R.innerDotR"
        [attr.fill]="markColor()"
      />
    }
    @if (innerMark() === 'check') {
      <svg:polyline
        [attr.points]="checkPoints()"
        fill="none"
        [attr.stroke]="markColor()"
        [attr.stroke-width]="S.innerMark"
        stroke-linecap="round"
        stroke-linejoin="round"
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
    @if (innerMark() === 'x') {
      <svg:line
        [attr.x1]="size() * R.squareXMin"
        [attr.y1]="size() * R.squareXMin"
        [attr.x2]="size() * R.squareXMax"
        [attr.y2]="size() * R.squareXMax"
        [attr.stroke]="markColor()"
        [attr.stroke-width]="S.innerMark"
        stroke-linecap="round"
      />
      <svg:line
        [attr.x1]="size() * R.squareXMax"
        [attr.y1]="size() * R.squareXMin"
        [attr.x2]="size() * R.squareXMin"
        [attr.y2]="size() * R.squareXMax"
        [attr.stroke]="markColor()"
        [attr.stroke-width]="S.innerMark"
        stroke-linecap="round"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HexagonIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');
  readonly innerMark = input<InnerMark>('none');
  readonly outlineDash = input<boolean>(false);

  protected readonly R = GLYPH_RATIOS;
  protected readonly S = GLYPH_STROKES;
  protected readonly dashPattern = GLYPH_STROKES.outlineDashPattern.join(',');

  readonly markColor = computed(() => (this.fillStyle() === 'outline' ? this.color() : 'white'));

  readonly hexagonPoints = computed(() => {
    const s = this.size();
    const [x1f, y1f, x2f, y2f, x3f, y3f, x4f, y4f, x5f, y5f, x6f, y6f] =
      GLYPH_RATIOS.hexagonPoints;
    return (
      `${s * x1f},${s * y1f} ${s * x2f},${s * y2f} ${s * x3f},${s * y3f} ` +
      `${s * x4f},${s * y4f} ${s * x5f},${s * y5f} ${s * x6f},${s * y6f}`
    );
  });

  readonly checkPoints = computed(() => {
    const s = this.size();
    const [x1f, y1f, x2f, y2f, x3f, y3f] = this.R.checkPoints;
    return `${s * x1f},${s * y1f} ${s * x2f},${s * y2f} ${s * x3f},${s * y3f}`;
  });
}
