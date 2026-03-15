import { Component, computed, inject, input, output } from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { TrialMarker } from '../../../core/models/marker.model';
import { Trial, TrialPhase } from '../../../core/models/trial.model';
import { TimelineColumn, TimelineService } from '../../../core/services/timeline.service';
import { GridHeaderComponent } from './grid-header.component';
import { MarkerComponent } from './marker.component';
import { PhaseBarComponent } from './phase-bar.component';
import { RowNotesComponent } from './row-notes.component';

interface FlattenedTrial {
  companyName: string;
  productName: string;
  trial: Trial;
}

@Component({
  selector: 'app-dashboard-grid',
  standalone: true,
  imports: [GridHeaderComponent, PhaseBarComponent, MarkerComponent, RowNotesComponent],
  templateUrl: './dashboard-grid.component.html',
})
export class DashboardGridComponent {
  private timeline = inject(TimelineService);

  companies = input.required<Company[]>();
  zoomLevel = input.required<ZoomLevel>();
  startYear = input.required<number>();
  endYear = input.required<number>();

  phaseClick = output<TrialPhase>();
  markerClick = output<TrialMarker>();

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

  onPhaseClick(phase: TrialPhase): void {
    this.phaseClick.emit(phase);
  }

  onMarkerClick(marker: TrialMarker): void {
    this.markerClick.emit(marker);
  }
}
