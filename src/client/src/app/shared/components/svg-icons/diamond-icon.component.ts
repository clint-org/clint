import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'g[app-diamond-icon]',
  standalone: true,
  template: `
    @if (fillStyle() === 'striped') {
      <svg:defs>
        <svg:pattern
          [attr.id]="'stripe-diamond-' + patternId"
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
        <svg:linearGradient [attr.id]="'grad-diamond-' + patternId" x1="0%" y1="0%" x2="100%" y2="100%">
          <svg:stop offset="0%" [attr.stop-color]="color()" stop-opacity="1" />
          <svg:stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.3" />
        </svg:linearGradient>
      </svg:defs>
    }
    <svg:polygon
      [attr.points]="points()"
      [attr.fill]="computedFill()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 2 : 0"
    />
  `,
})
export class DiamondIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly patternId = Math.random().toString(36).substring(2, 8);

  points = computed(() => {
    const s = this.size();
    const half = s / 2;
    return `${half},0 ${s},${half} ${half},${s} 0,${half}`;
  });

  computedFill(): string {
    switch (this.fillStyle()) {
      case 'outline':
        return 'none';
      case 'filled':
        return this.color();
      case 'striped':
        return `url(#stripe-diamond-${this.patternId})`;
      case 'gradient':
        return `url(#grad-diamond-${this.patternId})`;
    }
  }
}
