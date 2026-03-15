import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'g[app-flag-icon]',
  standalone: true,
  template: `
    @if (fillStyle() === 'striped') {
      <svg:defs>
        <svg:pattern
          [attr.id]="'stripe-flag-' + patternId"
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
        <svg:linearGradient [attr.id]="'grad-flag-' + patternId" x1="0%" y1="0%" x2="100%" y2="100%">
          <svg:stop offset="0%" [attr.stop-color]="color()" stop-opacity="1" />
          <svg:stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.3" />
        </svg:linearGradient>
      </svg:defs>
    }
    <!-- Pole -->
    <svg:line
      x1="1"
      y1="0"
      x2="1"
      [attr.y2]="size()"
      [attr.stroke]="color()"
      stroke-width="2"
    />
    <!-- Flag -->
    <svg:path
      [attr.d]="flagPath()"
      [attr.fill]="computedFill()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : 0"
    />
  `,
})
export class FlagIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly patternId = Math.random().toString(36).substring(2, 8);

  flagPath = computed(() => {
    const s = this.size();
    const flagHeight = s * 0.55;
    return `M 2,0 L ${s},${flagHeight / 2} L 2,${flagHeight} Z`;
  });

  computedFill(): string {
    switch (this.fillStyle()) {
      case 'outline':
        return 'none';
      case 'filled':
        return this.color();
      case 'striped':
        return `url(#stripe-flag-${this.patternId})`;
      case 'gradient':
        return `url(#grad-flag-${this.patternId})`;
    }
  }
}
