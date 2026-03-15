import { Component, input } from '@angular/core';

@Component({
  selector: 'g[app-bar-icon]',
  standalone: true,
  template: `
    @if (fillStyle() === 'striped') {
      <svg:defs>
        <svg:pattern
          [attr.id]="'stripe-bar-' + patternId"
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
          patternTransform="rotate(45)"
        >
          <svg:line x1="0" y1="0" x2="0" y2="4" [attr.stroke]="color()" stroke-width="1" />
        </svg:pattern>
      </svg:defs>
    }
    @if (fillStyle() === 'gradient') {
      <svg:defs>
        <svg:linearGradient [attr.id]="'grad-bar-' + patternId" x1="0%" y1="0%" x2="100%" y2="0%">
          <svg:stop offset="0%" [attr.stop-color]="color()" stop-opacity="1" />
          <svg:stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.3" />
        </svg:linearGradient>
      </svg:defs>
    }
    <svg:rect
      x="0"
      [attr.y]="(height() - barHeight) / 2"
      [attr.width]="width()"
      [attr.height]="barHeight"
      rx="2"
      [attr.fill]="computedFill()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : 0"
    />
  `,
})
export class BarIconComponent {
  width = input<number>(40);
  height = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly patternId = Math.random().toString(36).substring(2, 8);
  readonly barHeight = 6;

  computedFill(): string {
    switch (this.fillStyle()) {
      case 'outline':
        return 'none';
      case 'filled':
        return this.color();
      case 'striped':
        return `url(#stripe-bar-${this.patternId})`;
      case 'gradient':
        return `url(#grad-bar-${this.patternId})`;
    }
  }
}
