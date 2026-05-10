import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';

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
        [attr.r]="size() * 0.15"
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

  readonly markColor = computed(() => (this.fillStyle() === 'outline' ? this.color() : 'white'));

  readonly diamondPoints = computed(() => {
    const s = this.size();
    const cx = s / 2;
    const cy = s / 2;
    const hw = s * 0.42;
    const hh = s * 0.48;
    return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  });

  readonly checkPoints = computed(() => {
    const s = this.size();
    const x1 = s * 0.32;
    const y1 = s * 0.5;
    const x2 = s * 0.45;
    const y2 = s * 0.65;
    const x3 = s * 0.68;
    const y3 = s * 0.38;
    return `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
  });
}
