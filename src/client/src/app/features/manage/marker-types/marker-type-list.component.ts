import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerTypeFormComponent } from './marker-type-form.component';
import { ColorSwatchComponent } from '../../../shared/components/color-swatch.component';

@Component({
  selector: 'app-marker-type-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    MarkerTypeFormComponent,
    ColorSwatchComponent,
  ],
  templateUrl: './marker-type-list.component.html',
})
export class MarkerTypeListComponent implements OnInit {
  private markerTypeService = inject(MarkerTypeService);
  private route = inject(ActivatedRoute);
  spaceId = '';

  markerTypes = signal<MarkerType[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  modalOpen = signal(false);
  editingType = signal<MarkerType | null>(null);

  ngOnInit(): void {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.loadMarkerTypes();
  }

  openCreateModal(): void {
    this.editingType.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(mt: MarkerType): void {
    this.editingType.set(mt);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingType.set(null);
  }

  async loadMarkerTypes(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const types = await this.markerTypeService.list(this.spaceId);
      this.markerTypes.set(types);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load marker types');
    } finally {
      this.loading.set(false);
    }
  }

  async onTypeSaved(): Promise<void> {
    this.closeModal();
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
