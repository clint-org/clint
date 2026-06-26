import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import {
  PHASE_COLORS,
  PHASE_FALLBACK_COLOR,
  phaseShortLabel,
} from '../../../core/models/phase-colors';
import {
  DatePrecision,
  markerStartCaption,
} from '../../../core/models/marker-date-precision';
import { TimelineService } from '../../../core/services/timeline.service';
import { phaseFadeStops } from './phase-bar-fade';
import { EndpointTreatment, endpointTreatment } from './phase-bar-endpoint';

let phaseBarUid = 0;

const BAR_HEIGHT = 14;
const CORNER_RADIUS = 3;
const MIN_LABEL_WIDTH = 40;

@Component({
  selector: 'g[app-phase-bar]',
  standalone: true,
  templateUrl: './phase-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhaseBarComponent {
  private readonly timeline = inject(TimelineService);

  readonly phaseType = input.required<string>();
  readonly startDate = input.required<string>();
  readonly endDate = input<string | null>(null);
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly totalWidth = input.required<number>();
  /** Precision of the phase start date from deriveTrialPhaseSpan. */
  readonly startPrecision = input<DatePrecision | null>(null);
  /** Precision of the phase end date from deriveTrialPhaseSpan. */
  readonly endPrecision = input<DatePrecision | null>(null);

  readonly withdrawn = input(false);

  readonly phaseClick = output<void>();

  // Present-day frontier, used as the right edge of an open-ended (no end date)
  // phase so it reads as "ongoing" rather than rendering nothing.
  private readonly today = new Date().toISOString().slice(0, 10);

  private readonly rawStartX = computed(() =>
    this.timeline.dateToX(this.startDate(), this.startYear(), this.endYear(), this.totalWidth())
  );

  protected readonly barX = computed(() => Math.max(0, this.rawStartX()));

  /** The phase begins before the visible window (left edge is clipped). */
  protected readonly openLeft = computed(() => this.rawStartX() < 0);

  private readonly rawEndX = computed(() => {
    const endDate = this.endDate();
    if (endDate) {
      return this.timeline.dateToX(endDate, this.startYear(), this.endYear(), this.totalWidth());
    }
    // Open-ended: run to the present frontier (or a little past the start so a
    // future-dated open phase still shows), capped to the window width.
    return this.timeline.dateToX(this.today, this.startYear(), this.endYear(), this.totalWidth());
  });

  /** No end date (ongoing) or the phase ends after the visible window. */
  protected readonly openRight = computed(() => !this.endDate() || this.rawEndX() > this.totalWidth());

  protected readonly endX = computed(() =>
    Math.min(this.totalWidth(), Math.max(this.barX() + 24, this.rawEndX()))
  );

  protected readonly barWidth = computed(() => Math.max(0, this.endX() - this.barX()));

  /**
   * Stroke outline. Closed edges are stroked; an open (clipped or ongoing) edge
   * is left without a cap so the bar reads as continuing beyond the window. The
   * faint fill rect carries the body; this path carries the edges.
   */
  /** Unique mask id so each bar's edge fade is independent. */
  protected readonly maskId = `phase-fade-${phaseBarUid++}`;

  /** Mask gradient stops for the edge fade, or null when the bar is solid. */
  protected readonly fadeStops = computed(() =>
    phaseFadeStops(this.barWidth(), this.openLeft(), this.openRight())
  );

  protected readonly barColor = computed(
    () => PHASE_COLORS[this.phaseType()] ?? PHASE_FALLBACK_COLOR
  );

  protected readonly labelText = computed(() => phaseShortLabel(this.phaseType()));

  protected readonly showLabelInside = computed(() => this.barWidth() >= MIN_LABEL_WIDTH);

  readonly labelColor = computed(() => {
    if (!this.showLabelInside()) return '#64748b';
    return this.barColor();
  });

  protected readonly labelX = computed(() => {
    if (this.showLabelInside()) {
      return this.barX() + this.barWidth() / 2;
    }
    return this.barX() + this.barWidth() + 4;
  });

  protected readonly labelAnchor = computed(() => (this.showLabelInside() ? 'middle' : 'start'));

  /** How the left bar edge renders: feather (clipped), cap (approximate), or hard (exact). */
  protected readonly startTreatment = computed<EndpointTreatment>(() =>
    endpointTreatment(this.openLeft(), this.startPrecision())
  );

  /** How the right bar edge renders: feather (ongoing/clipped), cap (approximate), or hard (exact). */
  protected readonly endTreatment = computed<EndpointTreatment>(() =>
    endpointTreatment(this.openRight(), this.endPrecision())
  );

  /**
   * Caption for an approximate start cap: "~Nov '26", "~2026", etc.
   * Reuses markerStartCaption so the bar endpoint and the co-located Trial
   * Start marker show the same period string.
   */
  protected readonly startCapCaption = computed(() =>
    markerStartCaption(this.startDate(), this.startPrecision())
  );

  /**
   * Caption for an approximate end cap. Null when no end date is present
   * (open-ended bars render feather, not cap, so this path is defensive).
   */
  protected readonly endCapCaption = computed(() => {
    const end = this.endDate();
    if (!end) return null;
    return markerStartCaption(end, this.endPrecision());
  });

  protected barHeight = BAR_HEIGHT;
  protected cornerRadius = CORNER_RADIUS;

  onClick(): void {
    this.phaseClick.emit();
  }
}
