import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerTypeFormComponent } from './marker-type-form.component';
import { ColorSwatchComponent } from '../../../shared/components/color-swatch.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { createGridState } from '../../../shared/grids';
import { confirmDelete } from '../../../shared/utils/confirm-delete';

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
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    GridToolbarComponent,
  ],
  templateUrl: './marker-type-list.component.html',
})
export class MarkerTypeListComponent implements OnInit {
  private markerTypeService = inject(MarkerTypeService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);
  spaceId = '';

  markerTypes = signal<MarkerType[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  modalOpen = signal(false);
  editingType = signal<MarkerType | null>(null);

  // Stable menu-item references per row id (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  readonly grid = createGridState<MarkerType>({
    columns: [
      { field: 'name', header: 'Name', filter: { kind: 'text' } },
      { field: 'shape', header: 'Shape', filter: { kind: 'text' } },
      { field: 'fill_style', header: 'Fill', filter: { kind: 'text' } },
      {
        field: 'is_system',
        header: 'Origin',
        filter: { kind: 'text' },
        getValue: (mt) => (mt.is_system ? 'system' : 'custom'),
      },
    ],
    globalSearchFields: ['name', 'shape', 'fill_style'],
    defaultSort: { field: 'name', order: 1 },
  });

  readonly visibleTypes = this.grid.filteredRows(this.markerTypes);

  ngOnInit(): void {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.loadMarkerTypes();
  }

  rowMenu(mt: MarkerType): MenuItem[] {
    const cached = this.menuCache.get(mt.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Edit',
        icon: 'fa-solid fa-pen',
        command: () => this.openEditModal(mt),
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.deleteType(mt.id),
      },
    ];
    this.menuCache.set(mt.id, items);
    return items;
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
      this.menuCache.clear();
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
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete marker type',
      message: 'Any existing markers using this type will lose their type. This cannot be undone.',
    });
    if (!ok) return;
    try {
      await this.markerTypeService.delete(id);
      await this.loadMarkerTypes();
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not delete marker type. Check your connection and try again.'
      );
    }
  }
}
