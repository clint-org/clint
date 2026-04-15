import { Component, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { RouteOfAdministration } from '../../../core/models/route-of-administration.model';
import { RouteOfAdministrationService } from '../../../core/services/route-of-administration.service';
import { RouteOfAdministrationFormComponent } from './route-of-administration-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';

@Component({
  selector: 'app-route-of-administration-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    RouteOfAdministrationFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
  ],
  templateUrl: './route-of-administration-list.component.html',
})
export class RouteOfAdministrationListComponent implements OnInit, OnDestroy {
  items = signal<RouteOfAdministration[]>([]);
  loading = signal(false);
  modalOpen = signal(false);
  editingItem = signal<RouteOfAdministration | null>(null);
  deleteError = signal<string | null>(null);

  private roaService = inject(RouteOfAdministrationService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);

  private readonly menuCache = new Map<string, MenuItem[]>();

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.items().length || ''));
  });

  async ngOnInit(): Promise<void> {
    this.topbarState.actions.set([
      { label: 'Add route', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() },
    ]);
    await this.loadItems();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  rowMenu(item: RouteOfAdministration): MenuItem[] {
    const cached = this.menuCache.get(item.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Edit',
        icon: 'fa-solid fa-pen',
        command: () => this.openEditModal(item),
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.confirmDelete(item),
      },
    ];
    this.menuCache.set(item.id, items);
    return items;
  }

  openCreateModal(): void {
    this.editingItem.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(item: RouteOfAdministration): void {
    this.editingItem.set(item);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingItem.set(null);
  }

  async onSaved(): Promise<void> {
    const isEdit = !!this.editingItem();
    this.closeModal();
    await this.loadItems();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Route of administration updated.' : 'Route of administration created.',
      life: 3000,
    });
  }

  async confirmDelete(item: RouteOfAdministration): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete route of administration',
      message: `Delete "${item.name}"? This cannot be undone.`,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.roaService.delete(item.id);
      await this.loadItems();
      this.messageService.add({
        severity: 'success',
        summary: 'Route of administration deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete route of administration. It may be assigned to products.'
      );
    }
  }

  private async loadItems(): Promise<void> {
    this.loading.set(true);
    try {
      const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
      const data = await this.roaService.list(spaceId);
      this.items.set(data);
      this.menuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }
}
