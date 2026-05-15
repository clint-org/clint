import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
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
import { TableSkeletonBodyComponent } from '../../../shared/components/skeleton/table-skeleton-body.component';
import { HighlightPipe } from '../../../shared/pipes/highlight.pipe';
import { createGridState } from '../../../shared/grids';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

@Component({
  selector: 'app-marker-type-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    RouterLink,
    MarkerTypeFormComponent,
    ColorSwatchComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    HighlightPipe,
  ],
  templateUrl: './marker-type-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerTypeListComponent implements OnInit, OnDestroy {
  private markerTypeService = inject(MarkerTypeService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);
  spaceId = '';

  private readonly topbarActionsEffect = effect(() => {
    if (this.spaceRole.canEdit()) {
      this.topbarState.actions.set([
        {
          label: 'Add marker type',
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  readonly markerTypes = signal<MarkerType[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingType = signal<MarkerType | null>(null);

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
    persistenceKey: 'manage-marker-types',
  });

  readonly visibleTypes = this.grid.filteredRows(this.markerTypes);

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  ngOnInit(): void {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.loadMarkerTypes();
  }

  protected markersHelpLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    return ['/t', tenantId, 's', this.spaceId, 'help', 'markers'];
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  rowMenu(mt: MarkerType): MenuItem[] {
    const cached = this.menuCache.get(mt.id);
    if (cached) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
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
        }
      );
    }
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
    const wasEditing = this.editingType() !== null;
    this.closeModal();
    await this.loadMarkerTypes();
    this.messageService.add({
      severity: 'success',
      summary: wasEditing ? 'Marker type updated.' : 'Marker type created.',
      life: 3000,
    });
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
      this.messageService.add({
        severity: 'success',
        summary: 'Marker type deleted.',
        life: 3000,
      });
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not delete marker type. Check your connection and try again.'
      );
    }
  }
}
