import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { PositioningBubble, RING_ORDER, RingPhase } from '../../core/models/landscape.model';

const Y_PHASES: readonly RingPhase[] = RING_ORDER;

const PHASE_Y_RANK: Record<RingPhase, number> = {
  PRECLIN: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  APPROVED: 5,
  LAUNCHED: 6,
};

/** Minimum and maximum bubble radius (scales with unit_count). */
const MIN_RADIUS = 24;
const MAX_RADIUS = 56;

/**
 * 2D color gradient: teal (blue-ocean) -> amber -> red (red-ocean).
 * Uses RGB interpolation through a 3-stop ramp.
 */
function bubbleColor(competitorCount: number, phaseRank: number, maxCompetitors: number): string {
  const xNorm = maxCompetitors > 1 ? (competitorCount - 1) / (maxCompetitors - 1) : 0;
  const yNorm = phaseRank / 6;
  const t = Math.min(1, Math.max(0, (xNorm + yNorm) / 2));

  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t / 0.5;
    r = 13 + s * (217 - 13);
    g = 148 + s * (119 - 148);
    b = 136 + s * (6 - 136);
  } else {
    const s = (t - 0.5) / 0.5;
    r = 217 + s * (220 - 217);
    g = 119 + s * (38 - 119);
    b = 6 + s * (38 - 6);
  }

  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** Split a label like "PD-1 Inhibitors + NSCLC" into two lines. */
function splitLabel(label: string, maxChars: number): string[] {
  // For composite labels (MOA + TA), split on " + "
  const plusIdx = label.indexOf(' + ');
  if (plusIdx > 0) {
    const line1 = label.slice(0, plusIdx);
    const line2 = label.slice(plusIdx + 3);
    return [
      line1.length > maxChars ? line1.slice(0, maxChars - 1) + '\u2026' : line1,
      line2.length > maxChars ? line2.slice(0, maxChars - 1) + '\u2026' : line2,
    ];
  }
  // Single-dimension label
  if (label.length > maxChars) {
    return [label.slice(0, maxChars - 1) + '\u2026'];
  }
  return [label];
}

interface PlottedBubble {
  bubble: PositioningBubble;
  cx: number;
  cy: number;
  radius: number;
  color: string;
  labelLines: string[];
  fontSize: number;
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
    svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .quadrant-blue-ocean {
      fill: var(--brand-600);
    }
    .axis-tick-label {
      font-size: 14px;
      font-family: ui-monospace, monospace;
    }
    .axis-title-label {
      font-size: 15px;
      font-weight: 600;
    }
    .bubble-label-primary {
      font-weight: 600;
      pointer-events: none;
    }
    .bubble-label-secondary {
      font-weight: 500;
      pointer-events: none;
    }
    .empty-state-label {
      font-size: 18px;
    }
  `,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      [attr.aria-label]="
        'Competitive positioning scatter chart with ' + bubbles().length + ' bubbles'
      "
      (click)="onBackgroundClick($event)"
      (keydown.escape)="onBackgroundClick($event)"
    >
      <!-- Quadrant shading: blue-ocean (bottom-left) -->
      <rect
        [attr.x]="margin.left"
        [attr.y]="quadrantMidY()"
        [attr.width]="quadrantMidX() - margin.left"
        [attr.height]="height() - margin.bottom - quadrantMidY()"
        class="quadrant-blue-ocean"
        opacity="0.04"
      />
      <!-- Quadrant shading: red-ocean (top-right) -->
      <rect
        [attr.x]="quadrantMidX()"
        [attr.y]="margin.top"
        [attr.width]="width() - margin.right - quadrantMidX()"
        [attr.height]="quadrantMidY() - margin.top"
        fill="#dc2626"
        opacity="0.04"
      />

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
          class="axis-tick-label"
        >
          {{ phase }}
        </text>
      }

      <!-- X-axis tick labels -->
      @for (tick of xTicks(); track tick) {
        <text
          [attr.x]="competitorX(tick)"
          [attr.y]="height() - margin.bottom + 24"
          text-anchor="middle"
          fill="#94a3b8"
          class="axis-tick-label"
        >
          {{ tick }}
        </text>
      }

      <!-- X-axis title -->
      <text
        [attr.x]="(margin.left + width() - margin.right) / 2"
        [attr.y]="height() - 8"
        text-anchor="middle"
        fill="#64748b"
        class="axis-title-label"
      >
        {{ xLabel() }}
      </text>

      <!-- Y-axis title -->
      <text
        x="24"
        [attr.y]="(margin.top + height() - margin.bottom) / 2"
        text-anchor="middle"
        fill="#64748b"
        class="axis-title-label"
        [attr.transform]="'rotate(-90, 24, ' + (margin.top + height() - margin.bottom) / 2 + ')'"
      >
        Highest Phase
      </text>

      <!-- Bubbles -->
      @for (pb of plottedBubbles(); track pb.bubble.label) {
        <g
          class="cursor-pointer outline-none"
          [class.opacity-30]="selectedBubble() !== null && selectedBubble() !== pb.bubble"
          tabindex="0"
          [attr.aria-label]="
            pb.bubble.label +
            ': ' +
            pb.bubble.competitor_count +
            ' competitors, highest phase ' +
            pb.bubble.highest_phase +
            ', ' +
            pb.bubble.unit_count +
            ' ' +
            countUnit()
          "
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
            [attr.r]="pb.radius"
            [attr.fill]="pb.color"
            [attr.stroke]="selectedBubble() === pb.bubble ? '#0f172a' : 'white'"
            [attr.stroke-width]="selectedBubble() === pb.bubble ? 3 : 2"
            opacity="0.85"
          />
          <!-- Single-line label -->
          @if (pb.labelLines.length === 1) {
            <text
              [attr.x]="pb.cx"
              [attr.y]="pb.cy + pb.fontSize * 0.35"
              text-anchor="middle"
              fill="white"
              [style.font-size.px]="pb.fontSize"
              class="bubble-label-primary"
            >
              {{ pb.labelLines[0] }}
            </text>
          }
          <!-- Two-line label -->
          @if (pb.labelLines.length === 2) {
            <text
              [attr.x]="pb.cx"
              [attr.y]="pb.cy - pb.fontSize * 0.3"
              text-anchor="middle"
              fill="white"
              [style.font-size.px]="pb.fontSize"
              class="bubble-label-primary"
            >
              {{ pb.labelLines[0] }}
            </text>
            <text
              [attr.x]="pb.cx"
              [attr.y]="pb.cy + pb.fontSize * 0.95"
              text-anchor="middle"
              fill="rgba(255,255,255,0.85)"
              [style.font-size.px]="pb.fontSize - 1"
              class="bubble-label-secondary"
            >
              {{ pb.labelLines[1] }}
            </text>
          }
        </g>
      }

      <!-- Empty state -->
      @if (bubbles().length === 0) {
        <text
          [attr.x]="width() / 2"
          [attr.y]="height() / 2"
          text-anchor="middle"
          fill="#94a3b8"
          class="empty-state-label"
        >
          No data matches current filters
        </text>
      }
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositioningChartComponent {
  readonly bubbles = input.required<PositioningBubble[]>();
  readonly width = input<number>(1200);
  readonly height = input<number>(700);
  readonly countUnit = input<string>('assets');
  readonly xLabel = input<string>('Competitors');
  readonly selectedBubble = input<PositioningBubble | null>(null);

  readonly bubbleHover = output<PositioningBubble | null>();
  readonly bubbleClick = output<PositioningBubble>();

  readonly yPhases = Y_PHASES;

  readonly margin = { top: 40, right: 50, bottom: 55, left: 120 };

  readonly maxCompetitors = computed(() => {
    const max = Math.max(...this.bubbles().map((b) => b.competitor_count), 1);
    return Math.max(max, 2);
  });

  readonly maxUnitCount = computed(() => Math.max(...this.bubbles().map((b) => b.unit_count), 1));

  /** Quadrant boundary: midpoint of the X plot area. */
  readonly quadrantMidX = computed(() => {
    const plotW = this.width() - this.margin.left - this.margin.right;
    return this.margin.left + plotW * 0.45;
  });

  /** Quadrant boundary: midpoint of the Y plot area (between P3 and P4). */
  readonly quadrantMidY = computed(() => {
    return this.phaseY('P3' as RingPhase);
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
    const maxUnit = this.maxUnitCount();

    const raw = bubbles.map((b) => {
      // Scale radius by unit_count (sqrt scale so area is proportional)
      const unitNorm = maxUnit > 1 ? b.unit_count / maxUnit : 0.5;
      const radius = MIN_RADIUS + Math.sqrt(unitNorm) * (MAX_RADIUS - MIN_RADIUS);

      // Scale font and label chars to bubble size
      const fontSize = Math.max(10, Math.min(14, radius * 0.3));
      const maxChars = Math.max(6, Math.floor(radius * 0.28));

      return {
        bubble: b,
        cx: this.competitorX(b.competitor_count),
        cy: this.phaseY(b.highest_phase),
        radius,
        color: bubbleColor(b.competitor_count, b.highest_phase_rank, maxComp),
        labelLines: splitLabel(b.label, maxChars),
        fontSize,
      };
    });

    // Jitter pass: nudge overlapping bubbles
    const minX = this.margin.left + MIN_RADIUS;
    const maxX = this.width() - this.margin.right - MIN_RADIUS;
    const minY = this.margin.top + MIN_RADIUS;
    const maxY = this.height() - this.margin.bottom - MIN_RADIUS;

    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const dx = raw[j].cx - raw[i].cx;
        const dy = raw[j].cy - raw[i].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = (raw[i].radius + raw[j].radius) * 1.1;
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
