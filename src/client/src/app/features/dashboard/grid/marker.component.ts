import { Component, computed, inject, input, output } from '@angular/core';

import { MarkerType, TrialMarker } from '../../../core/models/marker.model';
import { TimelineService } from '../../../core/services/timeline.service';
import { ArrowIconComponent } from '../../../shared/components/svg-icons/arrow-icon.component';
import { BarIconComponent } from '../../../shared/components/svg-icons/bar-icon.component';
import { CircleIconComponent } from '../../../shared/components/svg-icons/circle-icon.component';
import { DiamondIconComponent } from '../../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../../shared/components/svg-icons/flag-icon.component';
import { XIconComponent } from '../../../shared/components/svg-icons/x-icon.component';
import { MarkerTooltipComponent } from './marker-tooltip.component';

const ICON_SIZE = 20;
const TOP_OFFSET = 5;

@Component({
  selector: 'app-marker',
  standalone: true,
  imports: [
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    ArrowIconComponent,
    XIconComponent,
    BarIconComponent,
    MarkerTooltipComponent,
  ],
  templateUrl: './marker.component.html',
})
export class MarkerComponent {
  private readonly timeline = inject(TimelineService);

  marker = input.required<TrialMarker>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  totalWidth = input.required<number>();

  markerClick = output<TrialMarker>();

  showTooltip = false;

  readonly iconSize = ICON_SIZE;
  readonly topOffset = TOP_OFFSET;

  markerType = computed<MarkerType | undefined>(() => this.marker().marker_types);

  markerX = computed(() =>
    Math.max(0, this.timeline.dateToX(
      this.marker().event_date,
      this.startYear(),
      this.endYear(),
      this.totalWidth(),
    )),
  );

  isRange = computed(() => !!this.marker().end_date);

  rangeWidth = computed(() => {
    const endDate = this.marker().end_date;
    if (!endDate) return 0;
    const endX = this.timeline.dateToX(
      endDate,
      this.startYear(),
      this.endYear(),
      this.totalWidth(),
    );
    return Math.max(0, endX - this.markerX());
  });

  tooltipText = computed(() => {
    const m = this.marker();
    return m.tooltip_text ?? this.markerType()?.name ?? '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
