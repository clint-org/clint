import { Component, computed, inject, input, output, signal } from '@angular/core';

import { Marker, MarkerType } from '../../../core/models/marker.model';
import { TimelineService } from '../../../core/services/timeline.service';
import { BarIconComponent } from '../../../shared/components/svg-icons/bar-icon.component';
import { MARKER_ICON_SIZE, MARKER_TOP_OFFSET } from '../../../shared/utils/grid-constants';
import { getMarkerIcon } from '../../../shared/utils/marker-icon';
import { MarkerTooltipComponent } from './marker-tooltip.component';

@Component({
  selector: 'app-marker',
  standalone: true,
  imports: [BarIconComponent, MarkerTooltipComponent],
  templateUrl: './marker.component.html',
})
export class MarkerComponent {
  private readonly timeline = inject(TimelineService);

  marker = input.required<Marker>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  totalWidth = input.required<number>();

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

  effectiveFillStyle = computed(() => {
    const projection = this.marker().projection;
    switch (projection) {
      case 'actual':
        return 'filled';
      case 'stout':
        return 'striped';
      case 'company':
      case 'primary':
      default:
        return 'outline';
    }
  });

  faIcon = computed(() => {
    const mt = this.markerType();
    if (!mt) return 'fa-solid fa-circle';
    return getMarkerIcon(mt.shape, this.effectiveFillStyle() as MarkerType['fill_style']);
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

  ariaLabel = computed(() => {
    const m = this.marker();
    return m.title || this.markerType()?.name || '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
