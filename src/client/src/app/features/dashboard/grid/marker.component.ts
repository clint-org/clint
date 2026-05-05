import { Component, computed, inject, input, output, signal } from '@angular/core';

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
})
export class MarkerComponent {
  private readonly timeline = inject(TimelineService);

  marker = input.required<Marker>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  totalWidth = input.required<number>();

  trialName = input<string>('');
  trialPhase = input<string>('');
  recruitmentStatus = input<string>('');
  companyName = input<string>('');
  productName = input<string>('');

  markerClick = output<Marker>();

  showTooltip = signal(false);

  readonly iconSize = MARKER_ICON_SIZE;
  readonly topOffset = MARKER_TOP_OFFSET;

  markerType = computed<MarkerType | undefined>(() => this.marker().marker_types);

  markerX = computed(() =>
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

  effectiveFillStyle = computed<FillStyle>(() => {
    return this.marker().projection === 'actual' ? 'filled' : 'outline';
  });

  isNle = computed(() => this.marker().no_longer_expected);

  isDashedLine = computed(() => this.markerType()?.shape === 'dashed-line');

  nleOpacity = computed(() => (this.isNle() ? 0.3 : 1));

  shortDate = computed(() => {
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

  ariaLabel = computed(() => {
    const m = this.marker();
    return m.title || this.markerType()?.name || '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
