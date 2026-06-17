import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { FillStyle, Marker, MarkerType } from '../../../core/models/marker.model';
import {
  isApproximate,
  markerPeriodLabel,
  markerStartCaption,
} from '../../../core/models/marker-date-precision';
import { resolveMarkerVisual } from '../../../core/models/marker-visual';
import { textColorOnWhite } from '../../../shared/utils/color-contrast';
import { TimelineService } from '../../../core/services/timeline.service';
import { MarkerIconComponent } from '../../../shared/components/svg-icons/marker-icon.component';
import { MARKER_ICON_SIZE, MARKER_TOP_OFFSET } from '../../../shared/utils/grid-constants';
import { MarkerTooltipComponent } from './marker-tooltip.component';

@Component({
  selector: 'app-marker',
  standalone: true,
  imports: [MarkerIconComponent, MarkerTooltipComponent],
  templateUrl: './marker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerComponent {
  private readonly timeline = inject(TimelineService);

  readonly marker = input.required<Marker>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly totalWidth = input.required<number>();

  /**
   * Row layout decides which date captions fit (see marker-label-layout.ts);
   * suppressed captions stay reachable via the hover tooltip.
   */
  readonly showDateLabel = input<boolean>(true);

  /**
   * The end-cap caption is secondary to start captions; row layout suppresses it
   * when it would collide (see marker-label-layout.ts). Suppressed end labels
   * stay reachable via the hover tooltip's full range.
   */
  readonly showEndLabel = input<boolean>(true);

  readonly trialName = input<string>('');
  readonly trialPhase = input<string>('');
  readonly recruitmentStatus = input<string>('');
  readonly companyName = input<string>('');
  readonly assetName = input<string>('');

  readonly markerClick = output<Marker>();

  readonly showTooltip = signal(false);

  readonly iconSize = MARKER_ICON_SIZE;
  readonly topOffset = MARKER_TOP_OFFSET;

  readonly markerType = computed<MarkerType | undefined>(() => this.marker().marker_types);

  readonly markerX = computed(() =>
    Math.max(
      0,
      this.timeline.dateToX(
        this.marker().event_date,
        this.startYear(),
        this.endYear(),
        this.totalWidth()
      )
    )
  );

  /** This marker spans time: a bounded end, or an open-ended "onwards". */
  readonly isRange = computed(() => {
    const m = this.marker();
    return m.is_ongoing || !!m.end_date;
  });

  /**
   * Right edge of the range tail in px. A bounded marker ends at its end_date;
   * an "onwards" marker runs to the window's right edge (continuing into the
   * future) where it fades out.
   */
  private readonly rangeEndX = computed(() => {
    const m = this.marker();
    if (m.is_ongoing) return this.totalWidth();
    if (!m.end_date) return this.markerX();
    return Math.min(
      this.totalWidth(),
      this.timeline.dateToX(m.end_date, this.startYear(), this.endYear(), this.totalWidth())
    );
  });

  /** Tail width in px (0 when the bar is a point). */
  readonly tailWidth = computed(() =>
    this.isRange() ? Math.max(0, this.rangeEndX() - this.markerX()) : 0
  );

  readonly isOngoing = computed(() => this.marker().is_ongoing);

  /** Period label for a fuzzy bounded end ("Q1 '27"), else null. */
  readonly endPeriodLabel = computed(() =>
    markerPeriodLabel(this.marker().end_date, this.marker().end_date_precision)
  );

  /** A bounded end exists and is itself approximate (render a hollow end cap). */
  readonly endIsFuzzy = computed(
    () => !this.marker().is_ongoing && isApproximate(this.marker().end_date_precision)
  );

  readonly visual = computed(() => resolveMarkerVisual(this.marker()));

  readonly effectiveFillStyle = computed<FillStyle>(() => this.visual().fillStyle);

  readonly isNle = computed(() => this.visual().isNle);

  readonly isDashedLine = computed(() => this.markerType()?.shape === 'dashed-line');

  /**
   * Date caption color: the marker type's color darkened (if needed) to the
   * AA 4.5:1 normal-text ratio on white. The icon keeps the raw color; only
   * the 8px text needs the boost.
   */
  readonly captionColor = computed(() => textColorOnWhite(this.markerType()?.color ?? '#475569'));

  readonly nleOpacity = computed(() => (this.isNle() ? 0.3 : 1));

  // Approximate markers show the period ("~Q4 '26"), not a false exact day.
  readonly shortDate = computed(() =>
    markerStartCaption(this.marker().event_date, this.marker().date_precision)
  );

  readonly ariaLabel = computed(() => {
    const m = this.marker();
    return m.title || this.markerType()?.name || '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
