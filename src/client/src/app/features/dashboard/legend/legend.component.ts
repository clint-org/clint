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
    const groupMap = new Map<string, { label: string; order: number; types: MarkerType[] }>();

    for (const t of types) {
      const cat = t.marker_categories;
      const label = cat?.name ?? 'Other';
      const order = cat?.display_order ?? 999;

      let group = groupMap.get(label);
      if (!group) {
        group = { label, order, types: [] };
        groupMap.set(label, group);
      }
      group.types.push(t);
    }

    return Array.from(groupMap.values()).sort((a, b) => a.order - b.order);
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
