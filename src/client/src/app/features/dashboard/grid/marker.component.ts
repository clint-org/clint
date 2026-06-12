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

  readonly shortDate = computed(() => {
    const d = new Date(this.marker().event_date);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${months[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
  });

  readonly ariaLabel = computed(() => {
    const m = this.marker();
    return m.title || this.markerType()?.name || '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
