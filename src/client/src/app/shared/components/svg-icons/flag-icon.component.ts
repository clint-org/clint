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
      [attr.x1]="poleX()"
      y1="0"
      [attr.x2]="poleX()"
      [attr.y2]="size()"
      [attr.stroke]="color()"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <!-- Flag -->
    <svg:path
      [attr.d]="flagPath()"
      [attr.fill]="computedFill()"
      [attr.stroke]="fillStyle() === 'outline' ? color() : (fillStyle() === 'filled' ? '#ffffff' : 'none')"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : (fillStyle() === 'filled' ? 0.5 : 0)"
      stroke-linejoin="round"
    />
  `,
})
export class FlagIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly patternId = Math.random().toString(36).substring(2, 8);

  poleX = computed(() => this.size() * 0.15);

  flagPath = computed(() => {
    const s = this.size();
    const poleX = s * 0.15;
    const flagTop = s * 0.05;
    const flagBottom = s * 0.55;
    const flagRight = s * 0.9;
    const midY = (flagTop + flagBottom) / 2;
    return `M ${poleX},${flagTop} C ${flagRight * 0.5},${flagTop - 1} ${flagRight * 0.8},${midY - 2} ${flagRight},${midY} C ${flagRight * 0.8},${midY + 2} ${flagRight * 0.5},${flagBottom + 1} ${poleX},${flagBottom} Z`;
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
