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
        <svg:linearGradient
          [attr.id]="'grad-diamond-' + patternId"
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
    <svg:path
      [attr.d]="diamondPath()"
      [attr.fill]="computedFill()"
      [attr.stroke]="fillStyle() === 'filled' ? 'white' : color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : fillStyle() === 'filled' ? 0.5 : 0"
      stroke-linejoin="round"
    />
    @if (fillStyle() === 'filled') {
      <svg:path [attr.d]="highlightPath()" fill="white" opacity="0.2" />
    }
  `,
})
export class DiamondIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<'outline' | 'filled' | 'striped' | 'gradient'>('filled');

  readonly patternId = Math.random().toString(36).substring(2, 8);

  diamondPath = computed(() => {
    const s = this.size();
    const cx = s / 2;
    const cy = s / 2;
    const hw = s * 0.42; // half-width (slightly narrower)
    const hh = s * 0.48; // half-height (slightly taller)
    return `M ${cx},${cy - hh} L ${cx + hw},${cy} L ${cx},${cy + hh} L ${cx - hw},${cy} Z`;
  });

  highlightPath = computed(() => {
    const s = this.size();
    const cx = s / 2;
    const cy = s / 2;
    const hw = s * 0.42;
    const hh = s * 0.48;
    // Small highlight in upper-left quadrant
    const scale = 0.4;
    const ox = -1; // offset left
    const oy = -1; // offset up
    return `M ${cx + ox},${cy - hh * scale + oy} L ${cx + hw * scale + ox},${cy + oy} L ${cx + ox},${cy + hh * scale + oy} L ${cx - hw * scale + ox},${cy + oy} Z`;
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
