import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { TherapeuticArea } from '../../../core/models/trial.model';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { TherapeuticAreaFormComponent } from './therapeutic-area-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { createGridState } from '../../../shared/grids';

@Component({
  selector: 'app-therapeutic-area-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    TherapeuticAreaFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    GridToolbarComponent,
  ],
  templateUrl: './therapeutic-area-list.component.html',
})
export class TherapeuticAreaListComponent implements OnInit {
  areas = signal<TherapeuticArea[]>([]);
  loading = signal(false);
  modalOpen = signal(false);
  editingArea = signal<TherapeuticArea | null>(null);
  deleteError = signal<string | null>(null);

  private areaService = inject(TherapeuticAreaService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);
  spaceId = '';

  // Stable menu-item references per row id (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  readonly grid = createGridState<TherapeuticArea>({
    columns: [
      { field: 'name', header: 'Name', filter: { kind: 'text' } },
      { field: 'abbreviation', header: 'Abbreviation', filter: { kind: 'text' } },
    ],
    globalSearchFields: ['name', 'abbreviation'],
    defaultSort: { field: 'name', order: 1 },
  });

  readonly visibleAreas = this.grid.filteredRows(this.areas);

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadAreas();
  }

  rowMenu(area: TherapeuticArea): MenuItem[] {
    const cached = this.menuCache.get(area.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Edit',
        icon: 'fa-solid fa-pen',
        command: () => this.openEditModal(area),
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.confirmDelete(area),
      },
    ];
    this.menuCache.set(area.id, items);
    return items;
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
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete therapeutic area',
      message: `Delete "${area.name}"? This cannot be undone.`,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.areaService.delete(area.id);
      await this.loadAreas();
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete therapeutic area. It may have associated trials.'
      );
    }
  }

  private async loadAreas(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.areaService.list(this.spaceId);
      this.areas.set(data);
      this.menuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }
}
