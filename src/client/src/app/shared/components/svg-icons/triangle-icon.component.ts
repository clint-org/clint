import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-triangle-icon]',
  standalone: true,
  template: `
    <svg:polygon
      [attr.points]="trianglePoints()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : 0"
      stroke-linejoin="round"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TriangleIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');

  readonly trianglePoints = computed(() => {
    const s = this.size();
    const x1 = s * 0.15;
    const y1 = s * 0.1;
    const x2 = s * 0.9;
    const y2 = s / 2;
    const x3 = s * 0.15;
    const y3 = s * 0.9;
    return `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
  });
}
