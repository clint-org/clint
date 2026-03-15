import { Component, inject, signal, OnInit } from '@angular/core';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerTypeFormComponent } from './marker-type-form.component';

@Component({
  selector: 'app-marker-type-list',
  standalone: true,
  imports: [MarkerTypeFormComponent],
  templateUrl: './marker-type-list.component.html',
})
export class MarkerTypeListComponent implements OnInit {
  private markerTypeService = inject(MarkerTypeService);

  markerTypes = signal<MarkerType[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  addingType = signal(false);
  editingType = signal<MarkerType | null>(null);

  ngOnInit(): void {
    this.loadMarkerTypes();
  }

  async loadMarkerTypes(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const types = await this.markerTypeService.list();
      this.markerTypes.set(types);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load marker types');
    } finally {
      this.loading.set(false);
    }
  }

  async onTypeSaved(): Promise<void> {
    this.addingType.set(false);
    this.editingType.set(null);
    await this.loadMarkerTypes();
  }

  async deleteType(id: string): Promise<void> {
    try {
      await this.markerTypeService.delete(id);
      await this.loadMarkerTypes();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to delete marker type');
    }
  }
}
