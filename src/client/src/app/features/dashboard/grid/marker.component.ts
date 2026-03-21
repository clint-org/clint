import { Component, computed, inject, input, output } from '@angular/core';

import { MarkerType, TrialMarker } from '../../../core/models/marker.model';
import { TimelineService } from '../../../core/services/timeline.service';
import { BarIconComponent } from '../../../shared/components/svg-icons/bar-icon.component';
import { MarkerTooltipComponent } from './marker-tooltip.component';

const ICON_SIZE = 18;
const TOP_OFFSET = 4;

@Component({
  selector: 'app-marker',
  standalone: true,
  imports: [BarIconComponent, MarkerTooltipComponent],
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

  isRange = computed(() => !!this.marker().end_date);

  rangeWidth = computed(() => {
    const endDate = this.marker().end_date;
    if (!endDate) return 0;
    const endX = this.timeline.dateToX(
      endDate,
      this.startYear(),
      this.endYear(),
      this.totalWidth()
    );
    return Math.max(0, endX - this.markerX());
  });

  faIcon = computed(() => {
    const mt = this.markerType();
    if (!mt) return 'fa-solid fa-circle';
    const shape = mt.shape;
    const fill = mt.fill_style;
    switch (shape) {
      case 'circle':
        return fill === 'outline' ? 'fa-regular fa-circle' : 'fa-solid fa-circle';
      case 'diamond':
        return fill === 'outline' ? 'fa-regular fa-gem' : 'fa-solid fa-gem';
      case 'flag':
        return fill === 'outline' ? 'fa-regular fa-flag' : 'fa-solid fa-flag';
      case 'arrow':
        return 'fa-solid fa-arrow-up';
      case 'x':
        return 'fa-solid fa-circle-xmark';
      case 'bar':
        return 'fa-solid fa-grip-lines';
      default:
        return 'fa-solid fa-circle';
    }
  });

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

  shortLabel = computed(() => {
    const name = this.markerType()?.name ?? '';
    const abbrevs: Record<string, string> = {
      'Projected Data Reported': 'Proj',
      'Data Reported': 'DR',
      'Primary Completion Date (PCD)': 'PCD',
      'Projected Regulatory Filing': 'Proj',
      'Submitted Regulatory Filing': 'Filed',
      'Label Projected Approval/Launch': 'Proj',
      'Label Update': 'Label',
      'Est. Range of Potential Launch': 'Range',
      'Change from Prior Update': 'Chg',
      'Event No Longer Expected': 'Rmvd',
    };
    return abbrevs[name] ?? name.slice(0, 4);
  });

  tooltipText = computed(() => {
    const m = this.marker();
    return m.tooltip_text ?? this.markerType()?.name ?? '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
