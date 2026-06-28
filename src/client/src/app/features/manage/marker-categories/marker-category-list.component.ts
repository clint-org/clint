import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { Tooltip } from 'primeng/tooltip';

import { MarkerCategory } from '../../../core/models/marker.model';
import {
  MarkerCategoryInUseError,
  MarkerCategoryService,
} from '../../../core/services/marker-category.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerCategoryFormComponent } from './marker-category-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import {
  buildTypeCounts,
  customCategoriesSorted,
  systemCategoriesSorted,
} from './marker-category-list.logic';

@Component({
  selector: 'app-marker-category-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    Tooltip,
    RouterLink,
    MarkerCategoryFormComponent,
    ManagePageShellComponent,
    StatusTagComponent,
  ],
  templateUrl: './marker-category-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerCategoryListComponent implements OnInit, OnDestroy {
  private categoryService = inject(MarkerCategoryService);
  private markerTypeService = inject(MarkerTypeService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);
  spaceId = '';

  readonly categories = signal<MarkerCategory[]>([]);
  readonly typeCountByCategory = signal<Map<string, number>>(new Map());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingCategory = signal<MarkerCategory | null>(null);

  readonly customCategories = computed(() => customCategoriesSorted(this.categories()));
  readonly systemCategories = computed(() => systemCategoriesSorted(this.categories()));

  private readonly topbarActionsEffect = effect(() => {
    if (this.spaceRole.canEdit()) {
      this.topbarState.actions.set([
        {
          label: 'Add category',
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  ngOnInit(): void {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.load();
  }

  protected markerTypesLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    return ['/t', tenantId, 's', this.spaceId, 'settings', 'marker-types'];
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  typeCount(categoryId: string): number {
    return this.typeCountByCategory().get(categoryId) ?? 0;
  }

  openCreateModal(): void {
    this.editingCategory.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(category: MarkerCategory): void {
    this.editingCategory.set(category);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingCategory.set(null);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [categories, types] = await Promise.all([
        this.categoryService.list(this.spaceId),
        this.markerTypeService.list(this.spaceId),
      ]);
      this.categories.set(categories);
      this.typeCountByCategory.set(buildTypeCounts(types));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      this.loading.set(false);
    }
  }

  async onSaved(): Promise<void> {
    const wasEditing = this.editingCategory() !== null;
    this.closeModal();
    await this.load();
    this.messageService.add({
      severity: 'success',
      summary: wasEditing ? 'Category updated.' : 'Category created.',
      life: 3000,
    });
  }

  async moveUp(category: MarkerCategory): Promise<void> {
    const list = this.customCategories();
    const idx = list.findIndex((x) => x.id === category.id);
    if (idx <= 0) return;
    await this.swapOrder(list[idx], list[idx - 1]);
  }

  async moveDown(category: MarkerCategory): Promise<void> {
    const list = this.customCategories();
    const idx = list.findIndex((x) => x.id === category.id);
    if (idx < 0 || idx >= list.length - 1) return;
    await this.swapOrder(list[idx], list[idx + 1]);
  }

  private async swapOrder(a: MarkerCategory, b: MarkerCategory): Promise<void> {
    try {
      await this.categoryService.update(a.id, { display_order: b.display_order });
      await this.categoryService.update(b.id, { display_order: a.display_order });
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not reorder categories.');
    }
  }

  async deleteCategory(category: MarkerCategory): Promise<void> {
    if (this.typeCount(category.id) > 0) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete category',
      message: `Delete "${category.name}"? This category will be removed from the legend.`,
    });
    if (!ok) return;
    try {
      await this.categoryService.delete(category.id);
      await this.load();
      this.messageService.add({ severity: 'success', summary: 'Category deleted.', life: 3000 });
    } catch (e) {
      this.error.set(
        e instanceof MarkerCategoryInUseError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not delete category.'
      );
    }
  }
}
