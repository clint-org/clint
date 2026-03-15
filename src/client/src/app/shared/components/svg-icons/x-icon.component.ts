import { Component, input } from '@angular/core';

@Component({
  selector: 'g[app-x-icon]',
  standalone: true,
  template: `
    <!-- Background circle for context -->
    <svg:circle
      [attr.cx]="size() / 2"
      [attr.cy]="size() / 2"
      [attr.r]="size() / 2 - 1"
      [attr.fill]="color()"
      opacity="0.15"
      stroke="none"
    />
    <!-- X mark -->
    <svg:line
      [attr.x1]="size() * 0.3"
      [attr.y1]="size() * 0.3"
      [attr.x2]="size() * 0.7"
      [attr.y2]="size() * 0.7"
      [attr.stroke]="color()"
      stroke-width="2"
      stroke-linecap="round"
    />
    <svg:line
      [attr.x1]="size() * 0.7"
      [attr.y1]="size() * 0.3"
      [attr.x2]="size() * 0.3"
      [attr.y2]="size() * 0.7"
      [attr.stroke]="color()"
      stroke-width="2"
      stroke-linecap="round"
    />
  `,
})
export class XIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');
}
