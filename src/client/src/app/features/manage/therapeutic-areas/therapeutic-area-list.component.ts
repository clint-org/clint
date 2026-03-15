import { Component, inject, OnInit, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { TherapeuticArea } from '../../../core/models/trial.model';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { TherapeuticAreaFormComponent } from './therapeutic-area-form.component';

@Component({
  selector: 'app-therapeutic-area-list',
  standalone: true,
  imports: [TableModule, ButtonModule, Dialog, MessageModule, TherapeuticAreaFormComponent],
  templateUrl: './therapeutic-area-list.component.html',
})
export class TherapeuticAreaListComponent implements OnInit {
  areas = signal<TherapeuticArea[]>([]);
  loading = signal(false);
  modalOpen = signal(false);
  editingArea = signal<TherapeuticArea | null>(null);
  deleteError = signal<string | null>(null);

  private areaService = inject(TherapeuticAreaService);

  async ngOnInit(): Promise<void> {
    await this.loadAreas();
  }

  openCreateModal(): void {
    this.editingArea.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(area: TherapeuticArea): void {
    this.editingArea.set(area);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingArea.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeModal();
    await this.loadAreas();
  }

  async confirmDelete(area: TherapeuticArea): Promise<void> {
    const confirmed = window.confirm(`Delete "${area.name}"? This action cannot be undone.`);
    if (!confirmed) return;

    this.deleteError.set(null);
    try {
      await this.areaService.delete(area.id);
      await this.loadAreas();
    } catch (err) {
      this.deleteError.set(err instanceof Error ? err.message : 'Failed to delete therapeutic area');
    }
  }

  private async loadAreas(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.areaService.list();
      this.areas.set(data);
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }
}
