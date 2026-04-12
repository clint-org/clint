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
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      class="w-full h-full"
      role="img"
      [attr.aria-label]="'Competitive positioning scatter chart with ' + bubbles().length + ' bubbles'"
      (click)="onBackgroundClick($event)"
      (keydown.escape)="onBackgroundClick($event)"
    >
      <line
        [attr.x1]="margin.left"
        [attr.y1]="margin.top"
        [attr.x2]="margin.left"
        [attr.y2]="height() - margin.bottom"
        stroke="#e2e8f0"
        stroke-width="1"
      />
      <line
        [attr.x1]="margin.left"
        [attr.y1]="height() - margin.bottom"
        [attr.x2]="width() - margin.right"
        [attr.y2]="height() - margin.bottom"
        stroke="#e2e8f0"
        stroke-width="1"
      />

      @for (phase of yPhases; track phase) {
        <text
          [attr.x]="margin.left - 8"
          [attr.y]="phaseY(phase) + 4"
          text-anchor="end"
          class="fill-slate-400"
          style="font-size: 11px; font-family: ui-monospace, monospace;"
        >{{ phase }}</text>
      }

      @for (tick of xTicks(); track tick) {
        <text
          [attr.x]="competitorX(tick)"
          [attr.y]="height() - margin.bottom + 18"
          text-anchor="middle"
          class="fill-slate-400"
          style="font-size: 11px; font-family: ui-monospace, monospace;"
        >{{ tick }}</text>
      }

      <text
        [attr.x]="(margin.left + width() - margin.right) / 2"
        [attr.y]="height() - 4"
        text-anchor="middle"
        class="fill-slate-500"
        style="font-size: 12px; font-weight: 600;"
      >Competitors</text>

      <text
        [attr.x]="14"
        [attr.y]="(margin.top + height() - margin.bottom) / 2"
        text-anchor="middle"
        class="fill-slate-500"
        style="font-size: 12px; font-weight: 600;"
        [attr.transform]="'rotate(-90, 14, ' + ((margin.top + height() - margin.bottom) / 2) + ')'"
      >Highest Phase</text>

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
            [attr.stroke-width]="selectedBubble() === pb.bubble ? 2.5 : 1.5"
            opacity="0.85"
          />
          <text
            [attr.x]="pb.cx"
            [attr.y]="pb.cy + 4"
            text-anchor="middle"
            fill="white"
            style="font-size: 10px; font-weight: 600; pointer-events: none;"
          >{{ pb.truncatedLabel }}</text>
        </g>
      }

      @if (bubbles().length === 0) {
        <text
          [attr.x]="width() / 2"
          [attr.y]="height() / 2"
          text-anchor="middle"
          class="fill-slate-400"
          style="font-size: 14px;"
        >No data matches current filters</text>
      }
    </svg>
  `,
})
export class PositioningChartComponent {
  readonly bubbles = input.required<PositioningBubble[]>();
  readonly width = input<number>(900);
  readonly height = input<number>(600);
  readonly countUnit = input<string>('products');
  readonly selectedBubble = input<PositioningBubble | null>(null);

  readonly bubbleHover = output<PositioningBubble | null>();
  readonly bubbleClick = output<PositioningBubble>();

  readonly yPhases = Y_PHASES;
  readonly bubbleRadius = 22;

  readonly margin = { top: 30, right: 30, bottom: 40, left: 80 };

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
      truncatedLabel: b.label.length > 6 ? b.label.slice(0, 5) + '\u2026' : b.label,
    }));

    const radius = this.bubbleRadius;
    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const dx = raw[j].cx - raw[i].cx;
        const dy = raw[j].cy - raw[i].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = radius * 2.2;
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
