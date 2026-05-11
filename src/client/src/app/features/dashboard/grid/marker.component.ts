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

  readonly effectiveFillStyle = computed<FillStyle>(() => {
    return this.marker().projection === 'actual' ? 'filled' : 'outline';
  });

  readonly isNle = computed(() => this.marker().no_longer_expected);

  readonly isDashedLine = computed(() => this.markerType()?.shape === 'dashed-line');

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
    return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  });

  readonly ariaLabel = computed(() => {
    const m = this.marker();
    return m.title || this.markerType()?.name || '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
