import { Component, computed, inject, input, OnInit, signal } from '@angular/core';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { getMarkerIcon } from '../../../shared/utils/marker-icon';

@Component({
  selector: 'app-legend',
  standalone: true,
  templateUrl: './legend.component.html',
})
export class LegendComponent implements OnInit {
  private markerTypeService = inject(MarkerTypeService);

  spaceId = input<string>();
  markerTypes = signal<MarkerType[]>([]);
  loading = signal(true);

  groupedMarkerTypes = computed(() => {
    const types = this.markerTypes();
    return [
      {
        label: 'Data',
        types: types.filter((t) => t.name.includes('Data') || t.name.includes('Completion')),
      },
      {
        label: 'Regulatory',
        types: types.filter((t) => t.name.includes('Regulatory') || t.name.includes('Filing')),
      },
      {
        label: 'Approval',
        types: types.filter(
          (t) =>
            t.name.includes('Approval') || t.name.includes('Launch') || t.name.includes('Label')
        ),
      },
      {
        label: 'Other',
        types: types.filter((t) => t.name.includes('Change') || t.name.includes('No Longer')),
      },
    ].filter((g) => g.types.length > 0);
  });

  faIcon(mt: MarkerType): string {
    return getMarkerIcon(mt.shape, mt.fill_style);
  }

  async ngOnInit(): Promise<void> {
    try {
      const types = await this.markerTypeService.list(this.spaceId());
      this.markerTypes.set(types);
    } catch {
      this.markerTypes.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
