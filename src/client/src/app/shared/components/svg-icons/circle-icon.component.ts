import { Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';

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
      [attr.stroke-width]="1.5"
    />
    @if (innerMark() === 'dot') {
      <svg:circle
        [attr.cx]="size() / 2"
        [attr.cy]="size() / 2"
        [attr.r]="size() * 0.15"
        [attr.fill]="markColor()"
      />
    }
    @if (innerMark() === 'dash') {
      <svg:line
        [attr.x1]="size() * 0.28"
        [attr.y1]="size() / 2"
        [attr.x2]="size() * 0.72"
        [attr.y2]="size() / 2"
        [attr.stroke]="markColor()"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    }
  `,
})
export class CircleIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');
  readonly innerMark = input<InnerMark>('none');

  readonly markColor = computed(() => this.fillStyle() === 'outline' ? this.color() : 'white');
}
