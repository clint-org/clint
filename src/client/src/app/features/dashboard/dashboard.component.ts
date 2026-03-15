import { Component, signal } from '@angular/core';

import { Company } from '../../core/models/company.model';
import { ZoomLevel } from '../../core/models/dashboard.model';
import { DashboardGridComponent } from './grid/dashboard-grid.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DashboardGridComponent],
  template: `
    <div class="p-4">
      <h1 class="mb-4 text-2xl font-bold text-gray-900">Clinical Trial Dashboard</h1>
      <app-dashboard-grid
        [companies]="companies()"
        [zoomLevel]="zoomLevel()"
        [startYear]="startYear()"
        [endYear]="endYear()"
        (zoomChange)="zoomLevel.set($event)"
      />
    </div>
  `,
})
export class DashboardComponent {
  companies = signal<Company[]>([]);
  zoomLevel = signal<ZoomLevel>('quarterly');
  startYear = signal(2020);
  endYear = signal(2026);
}
