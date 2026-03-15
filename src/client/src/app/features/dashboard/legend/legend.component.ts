import { Component, computed, inject, OnInit, signal } from '@angular/core';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { CircleIconComponent } from '../../../shared/components/svg-icons/circle-icon.component';
import { DiamondIconComponent } from '../../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../../shared/components/svg-icons/flag-icon.component';
import { ArrowIconComponent } from '../../../shared/components/svg-icons/arrow-icon.component';
import { XIconComponent } from '../../../shared/components/svg-icons/x-icon.component';
import { BarIconComponent } from '../../../shared/components/svg-icons/bar-icon.component';

@Component({
  selector: 'app-legend',
  standalone: true,
  imports: [
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    ArrowIconComponent,
    XIconComponent,
    BarIconComponent,
  ],
  templateUrl: './legend.component.html',
})
export class LegendComponent implements OnInit {
  private markerTypeService = inject(MarkerTypeService);

  markerTypes = signal<MarkerType[]>([]);
  loading = signal(true);

  groupedMarkerTypes = computed(() => {
    const types = this.markerTypes();
    return [
      {
        label: 'Data',
        types: types.filter(t => t.name.includes('Data') || t.name.includes('Completion')),
      },
      {
        label: 'Regulatory',
        types: types.filter(t => t.name.includes('Regulatory') || t.name.includes('Filing')),
      },
      {
        label: 'Approval',
        types: types.filter(
          t => t.name.includes('Approval') || t.name.includes('Launch') || t.name.includes('Label')
        ),
      },
      {
        label: 'Other',
        types: types.filter(t => t.name.includes('Change') || t.name.includes('No Longer')),
      },
    ].filter(g => g.types.length > 0);
  });

  async ngOnInit(): Promise<void> {
    try {
      const types = await this.markerTypeService.list();
      this.markerTypes.set(types);
    } catch {
      this.markerTypes.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
