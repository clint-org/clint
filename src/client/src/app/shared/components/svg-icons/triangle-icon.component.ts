import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle } from '../../../core/models/marker.model';
import { GLYPH_RATIOS, GLYPH_STROKES } from '../../../core/models/marker-visual';

@Component({
  selector: 'g[app-triangle-icon]',
  standalone: true,
  template: `
    <svg:polygon
      [attr.points]="trianglePoints()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? S.shape : 0"
      stroke-linejoin="round"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TriangleIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');

  protected readonly S = GLYPH_STROKES;

  readonly trianglePoints = computed(() => {
    const s = this.size();
    const [x1f, y1f, x2f, y2f, x3f, y3f] = GLYPH_RATIOS.trianglePoints;
    const x1 = s * x1f;
    const y1 = s * y1f;
    const x2 = s * x2f;
    const y2 = s * y2f;
    const x3 = s * x3f;
    const y3 = s * y3f;
    return `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
  });
}
