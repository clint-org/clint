import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { PHASE_COLOR, RingPhase } from '../../core/models/landscape.model';

interface SignalRing {
  kind: string;
  r: number;
  stroke: string;
  width: number;
  dash: string | null;
}

/**
 * The bullseye chart mark, rendered as a standalone glyph: a phase-colored core
 * wrapped by the same concentric signal rings the chart plots on each dot --
 * orange for recent activity, dashed slate for an asset that appears on
 * multiple spokes. Rings step outward from the core in that fixed order, so the
 * chart dot, hover tooltip, and detail pane all read identically. Primary
 * intelligence is no longer a ring here: it is carried by the brand bookmark
 * badge on the chart node (see bullseye-chart) so it never collides with the
 * blue approval marker. Phase / signal-ring colors are fixed data colors and
 * are never whitelabeled.
 *
 * Single source of truth for the mark geometry: both the hover tooltip and the
 * asset detail pane render this component rather than reimplementing the rings.
 * Geometry scales with `size`: core radius and the per-ring step are derived
 * from the 30px reference mark (core r=4.5, step=3.45).
 */
@Component({
  selector: 'app-bullseye-signal-mark',
  template: `
    <svg
      class="block shrink-0"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="'0 0 ' + size() + ' ' + size()"
      aria-hidden="true"
    >
      @for (ring of rings(); track ring.kind) {
        <circle
          [attr.cx]="center()"
          [attr.cy]="center()"
          fill="none"
          [attr.r]="ring.r"
          [attr.stroke]="ring.stroke"
          [attr.stroke-width]="ring.width"
          [attr.stroke-dasharray]="ring.dash"
        />
      }
      <circle [attr.cx]="center()" [attr.cy]="center()" [attr.r]="coreRadius()" [attr.fill]="coreColor()" />
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BullseyeSignalMarkComponent {
  readonly phase = input.required<RingPhase>();
  readonly hasRecentActivity = input<boolean>(false);
  readonly multiSpoke = input<boolean>(false);
  /** Overall mark size in px. Geometry scales relative to the 30px reference. */
  readonly size = input<number>(30);

  private readonly scale = computed(() => this.size() / 30);
  protected readonly center = computed(() => this.size() / 2);
  protected readonly coreRadius = computed(() => 4.5 * this.scale());

  protected readonly coreColor = computed(() => PHASE_COLOR[this.phase()] ?? '#64748b');

  protected readonly rings = computed<SignalRing[]>(() => {
    const scale = this.scale();
    const core = 4.5 * scale;
    const step = 3.45 * scale;
    const rings: SignalRing[] = [];
    let r = core + step;
    // Recent activity is the inner ring (on the chart it is an outward-expanding
    // pulse), then the dashed multi-spoke ring is outermost. Keep this order in
    // sync with the chart dot. Primary intelligence is a brand bookmark badge on
    // the node, not a ring.
    if (this.hasRecentActivity()) {
      rings.push({ kind: 'activity', r, stroke: '#f97316', width: 2.1 * scale, dash: null });
      r += step;
    }
    if (this.multiSpoke()) {
      rings.push({
        kind: 'spokes',
        r,
        stroke: '#94a3b8',
        width: 1.5 * scale,
        dash: `${1.5 * scale} ${1.5 * scale}`,
      });
      r += step;
    }
    return rings;
  });
}
