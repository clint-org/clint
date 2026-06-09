import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';
import { GLYPH_RATIOS } from '../../../core/models/marker-visual';

@Component({
  selector: 'g[app-diamond-icon]',
  standalone: true,
  template: `
    <svg:polygon
      [attr.points]="diamondPoints()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="1.5"
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
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiamondIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');
  readonly innerMark = input<InnerMark>('none');

  protected readonly R = GLYPH_RATIOS;

  readonly markColor = computed(() => (this.fillStyle() === 'outline' ? this.color() : 'white'));

  readonly diamondPoints = computed(() => {
    const s = this.size();
    const cx = s / 2;
    const cy = s / 2;
    const hw = s * this.R.diamondHalfW;
    const hh = s * this.R.diamondHalfH;
    return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  });

  readonly checkPoints = computed(() => {
    const s = this.size();
    const [x1f, y1f, x2f, y2f, x3f, y3f] = this.R.checkPoints;
    const x1 = s * x1f;
    const y1 = s * y1f;
    const x2 = s * x2f;
    const y2 = s * y2f;
    const x3 = s * x3f;
    const y3 = s * y3f;
    return `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
  });
}
