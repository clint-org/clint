import { Component, computed, input, output } from '@angular/core';

import { PositioningBubble, RING_ORDER, RingPhase } from '../../core/models/landscape.model';

const Y_PHASES: readonly RingPhase[] = RING_ORDER;

const PHASE_Y_RANK: Record<RingPhase, number> = {
  PRECLIN: 0, P1: 1, P2: 2, P3: 3, P4: 4, APPROVED: 5, LAUNCHED: 6,
};

function bubbleColor(competitorCount: number, phaseRank: number, maxCompetitors: number): string {
  const xNorm = maxCompetitors > 1 ? (competitorCount - 1) / (maxCompetitors - 1) : 0;
  const yNorm = phaseRank / 6;
  const intensity = (xNorm + yNorm) / 2;
  const hue = 168 - intensity * 168;
  const saturation = 60 + intensity * 15;
  const lightness = 45 - intensity * 10;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

interface PlottedBubble {
  bubble: PositioningBubble;
  cx: number;
  cy: number;
  color: string;
  truncatedLabel: string;
}

@Component({
  selector: 'app-positioning-chart',
  standalone: true,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      preserveAspectRatio="xMidYMid meet"
      style="width: 100%; height: 100%; display: block;"
      role="img"
      [attr.aria-label]="'Competitive positioning scatter chart with ' + bubbles().length + ' bubbles'"
      (click)="onBackgroundClick($event)"
      (keydown.escape)="onBackgroundClick($event)"
    >
      <!-- Y-axis line -->
      <line
        [attr.x1]="margin.left"
        [attr.y1]="margin.top"
        [attr.x2]="margin.left"
        [attr.y2]="height() - margin.bottom"
        stroke="#e2e8f0"
        stroke-width="1.5"
      />
      <!-- X-axis line -->
      <line
        [attr.x1]="margin.left"
        [attr.y1]="height() - margin.bottom"
        [attr.x2]="width() - margin.right"
        [attr.y2]="height() - margin.bottom"
        stroke="#e2e8f0"
        stroke-width="1.5"
      />

      <!-- Y-axis phase tick lines and labels -->
      @for (phase of yPhases; track phase) {
        <line
          [attr.x1]="margin.left"
          [attr.y1]="phaseY(phase)"
          [attr.x2]="width() - margin.right"
          [attr.y2]="phaseY(phase)"
          stroke="#f1f5f9"
          stroke-width="1"
        />
        <text
          [attr.x]="margin.left - 12"
          [attr.y]="phaseY(phase) + 5"
          text-anchor="end"
          fill="#94a3b8"
          style="font-size: 14px; font-family: ui-monospace, monospace;"
        >{{ phase }}</text>
      }

      <!-- X-axis tick labels -->
      @for (tick of xTicks(); track tick) {
        <text
          [attr.x]="competitorX(tick)"
          [attr.y]="height() - margin.bottom + 24"
          text-anchor="middle"
          fill="#94a3b8"
          style="font-size: 14px; font-family: ui-monospace, monospace;"
        >{{ tick }}</text>
      }

      <!-- X-axis title -->
      <text
        [attr.x]="(margin.left + width() - margin.right) / 2"
        [attr.y]="height() - 8"
        text-anchor="middle"
        fill="#64748b"
        style="font-size: 15px; font-weight: 600;"
      >Competitors</text>

      <!-- Y-axis title -->
      <text
        x="24"
        [attr.y]="(margin.top + height() - margin.bottom) / 2"
        text-anchor="middle"
        fill="#64748b"
        style="font-size: 15px; font-weight: 600;"
        [attr.transform]="'rotate(-90, 24, ' + ((margin.top + height() - margin.bottom) / 2) + ')'"
      >Highest Phase</text>

      <!-- Bubbles -->
      @for (pb of plottedBubbles(); track pb.bubble.label) {
        <g
          class="cursor-pointer outline-none"
          [class.opacity-30]="selectedBubble() !== null && selectedBubble() !== pb.bubble"
          tabindex="0"
          [attr.aria-label]="pb.bubble.label + ': ' + pb.bubble.competitor_count + ' competitors, highest phase ' + pb.bubble.highest_phase + ', ' + pb.bubble.unit_count + ' ' + countUnit()"
          (click)="onBubbleClick($event, pb.bubble)"
          (mouseenter)="bubbleHover.emit(pb.bubble)"
          (mouseleave)="bubbleHover.emit(null)"
          (focus)="bubbleHover.emit(pb.bubble)"
          (blur)="bubbleHover.emit(null)"
          (keydown.enter)="onBubbleClick($event, pb.bubble)"
          (keydown.space)="onBubbleClick($event, pb.bubble)"
        >
          <circle
            [attr.cx]="pb.cx"
            [attr.cy]="pb.cy"
            [attr.r]="bubbleRadius"
            [attr.fill]="pb.color"
            [attr.stroke]="selectedBubble() === pb.bubble ? '#0f172a' : 'white'"
            [attr.stroke-width]="selectedBubble() === pb.bubble ? 3 : 2"
            opacity="0.85"
          />
          <text
            [attr.x]="pb.cx"
            [attr.y]="pb.cy + 5"
            text-anchor="middle"
            fill="white"
            style="font-size: 13px; font-weight: 600; pointer-events: none;"
          >{{ pb.truncatedLabel }}</text>
        </g>
      }

      <!-- Empty state -->
      @if (bubbles().length === 0) {
        <text
          [attr.x]="width() / 2"
          [attr.y]="height() / 2"
          text-anchor="middle"
          fill="#94a3b8"
          style="font-size: 18px;"
        >No data matches current filters</text>
      }
    </svg>
  `,
})
export class PositioningChartComponent {
  readonly bubbles = input.required<PositioningBubble[]>();
  readonly width = input<number>(1200);
  readonly height = input<number>(700);
  readonly countUnit = input<string>('products');
  readonly selectedBubble = input<PositioningBubble | null>(null);

  readonly bubbleHover = output<PositioningBubble | null>();
  readonly bubbleClick = output<PositioningBubble>();

  readonly yPhases = Y_PHASES;
  readonly bubbleRadius = 32;

  readonly margin = { top: 40, right: 50, bottom: 55, left: 120 };

  readonly maxCompetitors = computed(() => {
    const max = Math.max(...this.bubbles().map((b) => b.competitor_count), 1);
    return Math.max(max, 2);
  });

  readonly xTicks = computed(() => {
    const max = this.maxCompetitors();
    const ticks: number[] = [];
    for (let i = 1; i <= max; i++) ticks.push(i);
    return ticks;
  });

  readonly plottedBubbles = computed<PlottedBubble[]>(() => {
    const bubbles = this.bubbles();
    const maxComp = this.maxCompetitors();

    const raw = bubbles.map((b) => ({
      bubble: b,
      cx: this.competitorX(b.competitor_count),
      cy: this.phaseY(b.highest_phase),
      color: bubbleColor(b.competitor_count, b.highest_phase_rank, maxComp),
      truncatedLabel: b.label.length > 12 ? b.label.slice(0, 11) + '\u2026' : b.label,
    }));

    const radius = this.bubbleRadius;
    const minX = this.margin.left + radius;
    const maxX = this.width() - this.margin.right - radius;
    const minY = this.margin.top + radius;
    const maxY = this.height() - this.margin.bottom - radius;

    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const dx = raw[j].cx - raw[i].cx;
        const dy = raw[j].cy - raw[i].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = radius * 2.4;
        if (dist < minDist) {
          const nudge = (minDist - dist) / 2 + 1;
          const angle = dist > 0 ? Math.atan2(dy, dx) : (j * Math.PI) / 4;
          raw[i].cx -= Math.cos(angle) * nudge;
          raw[i].cy -= Math.sin(angle) * nudge;
          raw[j].cx += Math.cos(angle) * nudge;
          raw[j].cy += Math.sin(angle) * nudge;
        }
      }
    }

    // Clamp positions to stay within the plot area
    for (const b of raw) {
      b.cx = Math.max(minX, Math.min(maxX, b.cx));
      b.cy = Math.max(minY, Math.min(maxY, b.cy));
    }

    return raw;
  });

  phaseY(phase: RingPhase): number {
    const rank = PHASE_Y_RANK[phase] ?? 0;
    const plotH = this.height() - this.margin.top - this.margin.bottom;
    return this.margin.top + plotH - (rank / 6) * plotH;
  }

  competitorX(count: number): number {
    const plotW = this.width() - this.margin.left - this.margin.right;
    const max = this.maxCompetitors();
    const ratio = max > 1 ? (count - 1) / (max - 1) : 0.5;
    return this.margin.left + ratio * plotW;
  }

  onBubbleClick(event: Event, bubble: PositioningBubble): void {
    event.stopPropagation();
    this.bubbleClick.emit(bubble);
  }

  onBackgroundClick(event: Event): void {
    if ((event.target as Element).tagName === 'svg') {
      this.bubbleClick.emit(undefined as unknown as PositioningBubble);
    }
  }
}
