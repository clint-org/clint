import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-flag-icon]',
  standalone: true,
  template: `
    <svg:line
      [attr.x1]="poleX()"
      [attr.y1]="1"
      [attr.x2]="poleX()"
      [attr.y2]="size() - 1"
      [attr.stroke]="color()"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <svg:path
      [attr.d]="flagPath()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.2 : 0.5"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlagIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');

  readonly poleX = computed(() => this.size() * 0.15);

  readonly flagPath = computed(() => {
    const s = this.size();
    const px = this.poleX();
    const fw = s * 0.8;
    const fh = s * 0.6;
    const cp1y = fh * 0.3;
    const cp2y = fh * 0.7;
    return `M${px},1 Q${px + fw * 0.5},${1 + cp1y} ${px + fw},${1} L${px + fw},${1 + fh} Q${px + fw * 0.5},${1 + cp2y} ${px},${1 + fh} Z`;
  });
}
