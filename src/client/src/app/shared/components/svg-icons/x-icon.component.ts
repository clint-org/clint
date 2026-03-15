import { Component, input } from '@angular/core';

@Component({
  selector: 'g[app-x-icon]',
  standalone: true,
  template: `
    <svg:line
      [attr.x1]="padding"
      [attr.y1]="padding"
      [attr.x2]="size() - padding"
      [attr.y2]="size() - padding"
      [attr.stroke]="color()"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <svg:line
      [attr.x1]="size() - padding"
      [attr.y1]="padding"
      [attr.x2]="padding"
      [attr.y2]="size() - padding"
      [attr.stroke]="color()"
      stroke-width="2.5"
      stroke-linecap="round"
    />
  `,
})
export class XIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly padding = 2;
}
