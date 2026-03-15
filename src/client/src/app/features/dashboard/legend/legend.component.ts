import { Component, computed, inject, OnInit, signal } from '@angular/core';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';

@Component({
  selector: 'app-legend',
  standalone: true,
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

  faIcon(mt: MarkerType): string {
    switch (mt.shape) {
      case 'circle':
        return mt.fill_style === 'outline' ? 'fa-regular fa-circle' : 'fa-solid fa-circle';
      case 'diamond':
        return mt.fill_style === 'outline' ? 'fa-regular fa-gem' : 'fa-solid fa-gem';
      case 'flag':
        return mt.fill_style === 'outline' ? 'fa-regular fa-flag' : 'fa-solid fa-flag';
      case 'arrow':
        return 'fa-solid fa-arrow-up';
      case 'x':
        return 'fa-solid fa-circle-xmark';
      case 'bar':
        return 'fa-solid fa-grip-lines';
      default:
        return 'fa-solid fa-circle';
    }
  }

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
