import { Component, computed, inject, input, output } from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { Trial } from '../../../core/models/trial.model';
import { TimelineColumn, TimelineService } from '../../../core/services/timeline.service';
import { ZoomControlComponent } from '../zoom-control/zoom-control.component';
import { GridHeaderComponent } from './grid-header.component';

interface FlattenedTrial {
  companyName: string;
  productName: string;
  trial: Trial;
}

@Component({
  selector: 'app-dashboard-grid',
  standalone: true,
  imports: [GridHeaderComponent, ZoomControlComponent],
  templateUrl: './dashboard-grid.component.html',
})
export class DashboardGridComponent {
  private timeline = inject(TimelineService);

  companies = input.required<Company[]>();
  zoomLevel = input.required<ZoomLevel>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  zoomChange = output<ZoomLevel>();

  columns = computed<TimelineColumn[]>(() =>
    this.timeline.getColumns(this.startYear(), this.endYear(), this.zoomLevel())
  );

  totalWidth = computed<number>(() =>
    this.timeline.getTimelineWidth(this.startYear(), this.endYear(), this.zoomLevel())
  );

  flattenedTrials = computed<FlattenedTrial[]>(() => {
    const rows: FlattenedTrial[] = [];
    for (const company of this.companies()) {
      for (const product of company.products ?? []) {
        for (const trial of product.trials ?? []) {
          rows.push({
            companyName: company.name,
            productName: product.name,
            trial,
          });
        }
      }
    }
    return rows;
  });

  hasSubColumns(): boolean {
    return this.columns().some(c => c.subColumns && c.subColumns.length > 0);
  }

  onZoomChange(zoom: ZoomLevel): void {
    this.zoomChange.emit(zoom);
  }
}
