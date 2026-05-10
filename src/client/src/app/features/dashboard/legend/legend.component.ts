import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { CircleIconComponent } from '../../../shared/components/svg-icons/circle-icon.component';
import { DiamondIconComponent } from '../../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../../shared/components/svg-icons/flag-icon.component';
import { TriangleIconComponent } from '../../../shared/components/svg-icons/triangle-icon.component';
import { SquareIconComponent } from '../../../shared/components/svg-icons/square-icon.component';

@Component({
  selector: 'app-legend',
  standalone: true,
  imports: [
    RouterLink,
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  templateUrl: './legend.component.html',
})
export class LegendComponent implements OnInit {
  private markerTypeService = inject(MarkerTypeService);
  private route = inject(ActivatedRoute);

  readonly spaceId = input<string>();
  readonly markerTypes = signal<MarkerType[]>([]);
  readonly loading = signal(true);

  protected markersHelpLink(): string[] | null {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    const spaceId = this.spaceId() ?? this.route.snapshot.paramMap.get('spaceId');
    if (!tenantId || !spaceId) return null;
    return ['/t', tenantId, 's', spaceId, 'help', 'markers'];
  }

  protected phasesHelpLink(): string[] | null {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    if (!tenantId) return null;
    return ['/t', tenantId, 'help', 'phases'];
  }

  readonly groupedMarkerTypes = computed(() => {
    const types = this.markerTypes().filter((t) => t.display_order > 0);
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
