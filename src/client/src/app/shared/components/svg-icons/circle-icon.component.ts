import { Component, input } from '@angular/core';

@Component({
  selector: 'g[app-circle-icon]',
  standalone: true,
  template: `
    @if (fillStyle() === 'striped') {
      <svg:defs>
        <svg:pattern
          [attr.id]="'stripe-circle-' + patternId"
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
        <svg:linearGradient
          [attr.id]="'grad-circle-' + patternId"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <svg:stop offset="0%" [attr.stop-color]="color()" stop-opacity="1" />
          <svg:stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.3" />
        </svg:linearGradient>
      </svg:defs>
    }
    <svg:circle
      [attr.cx]="size() / 2"
      [attr.cy]="size() / 2"
      [attr.r]="size() / 2 - 1"
      [attr.fill]="computedFill()"
      [attr.stroke]="fillStyle() === 'filled' ? 'white' : color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : fillStyle() === 'filled' ? 0.5 : 0"
      [attr.stroke-linecap]="fillStyle() === 'outline' ? 'round' : null"
    />
    @if (fillStyle() === 'filled') {
      <svg:circle
        [attr.cx]="size() / 2 - 1"
        [attr.cy]="size() / 2 - 1"
        [attr.r]="size() / 4"
        fill="white"
        opacity="0.2"
      />
    }
  `,
})
export class CircleIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly patternId = Math.random().toString(36).substring(2, 8);

  computedFill(): string {
    switch (this.fillStyle()) {
      case 'outline':
        return 'none';
      case 'filled':
        return this.color();
      case 'striped':
        return `url(#stripe-circle-${this.patternId})`;
      case 'gradient':
        return `url(#grad-circle-${this.patternId})`;
    }
  }
}
