import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'g[app-arrow-icon]',
  standalone: true,
  template: `
    @if (fillStyle() === 'striped') {
      <svg:defs>
        <svg:pattern
          [attr.id]="'stripe-arrow-' + patternId"
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
        <svg:linearGradient [attr.id]="'grad-arrow-' + patternId" x1="0%" y1="0%" x2="100%" y2="100%">
          <svg:stop offset="0%" [attr.stop-color]="color()" stop-opacity="1" />
          <svg:stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.3" />
        </svg:linearGradient>
      </svg:defs>
    }
    <svg:path
      [attr.d]="arrowPath()"
      [attr.fill]="computedFill()"
      [attr.stroke]="fillStyle() === 'outline' ? color() : (fillStyle() === 'filled' ? '#ffffff' : 'none')"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : (fillStyle() === 'filled' ? 0.5 : 0)"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  `,
})
export class ArrowIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly patternId = Math.random().toString(36).substring(2, 8);

  arrowPath = computed(() => {
    const s = this.size();
    const cx = s / 2;
    const stemW = s * 0.15;
    const headW = s * 0.4;
    const headH = s * 0.4;
    const stemTop = headH;
    return `M ${cx},0 L ${cx + headW},${headH} L ${cx + stemW},${stemTop} L ${cx + stemW},${s} L ${cx - stemW},${s} L ${cx - stemW},${stemTop} L ${cx - headW},${headH} Z`;
  });

  computedFill(): string {
    switch (this.fillStyle()) {
      case 'outline':
        return 'none';
      case 'filled':
        return this.color();
      case 'striped':
        return `url(#stripe-arrow-${this.patternId})`;
      case 'gradient':
        return `url(#grad-arrow-${this.patternId})`;
    }
  }
}
