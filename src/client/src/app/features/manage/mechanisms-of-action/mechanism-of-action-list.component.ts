import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { MechanismOfActionFormComponent } from './mechanism-of-action-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { TableSkeletonBodyComponent } from '../../../shared/components/skeleton/table-skeleton-body.component';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

@Component({
  selector: 'app-mechanism-of-action-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    MechanismOfActionFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    TableSkeletonBodyComponent,
  ],
  templateUrl: './mechanism-of-action-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MechanismOfActionListComponent implements OnInit, OnDestroy {
  readonly items = signal<MechanismOfAction[]>([]);
  readonly loading = signal(false);
  readonly modalOpen = signal(false);
  readonly editingItem = signal<MechanismOfAction | null>(null);
  readonly deleteError = signal<string | null>(null);

  private moaService = inject(MechanismOfActionService);
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
          label: 'Add mechanism',
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  // Stable menu-item references per row id (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.items().length || ''));
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadItems();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  rowMenu(item: MechanismOfAction): MenuItem[] {
    const cached = this.menuCache.get(item.id);
    if (cached) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
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
        }
      );
    }
    this.menuCache.set(item.id, items);
    return items;
  }

  openCreateModal(): void {
    this.editingItem.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(item: MechanismOfAction): void {
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
      summary: isEdit ? 'Mechanism of action updated.' : 'Mechanism of action created.',
      life: 3000,
    });
  }

  async confirmDelete(item: MechanismOfAction): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete mechanism of action',
      message: `Delete "${item.name}"? This cannot be undone.`,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.moaService.delete(item.id);
      await this.loadItems();
      this.messageService.add({
        severity: 'success',
        summary: 'Mechanism of action deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete mechanism of action. It may be assigned to products.'
      );
    }
  }

  private async loadItems(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.moaService.list(this.spaceId);
      this.items.set(data);
      this.menuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }
}
