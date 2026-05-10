import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-square-icon]',
  standalone: true,
  template: `
    <svg:rect
      [attr.x]="padding()"
      [attr.y]="padding()"
      [attr.width]="innerSize()"
      [attr.height]="innerSize()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : 0"
    />
    @if (innerMark() === 'x') {
      <svg:line
        [attr.x1]="size() * 0.3"
        [attr.y1]="size() * 0.3"
        [attr.x2]="size() * 0.7"
        [attr.y2]="size() * 0.7"
        [attr.stroke]="markColor()"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <svg:line
        [attr.x1]="size() * 0.7"
        [attr.y1]="size() * 0.3"
        [attr.x2]="size() * 0.3"
        [attr.y2]="size() * 0.7"
        [attr.stroke]="markColor()"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SquareIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');
  readonly innerMark = input<InnerMark>('none');

  readonly padding = computed(() => this.size() * 0.1);
  readonly innerSize = computed(() => this.size() * 0.8);
  readonly markColor = computed(() => (this.fillStyle() === 'outline' ? this.color() : 'white'));
}
