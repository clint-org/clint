import { Component, inject, OnInit, signal } from '@angular/core';

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
