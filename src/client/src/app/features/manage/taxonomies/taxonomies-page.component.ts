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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { SelectButton } from 'primeng/selectbutton';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Indication } from '../../../core/models/indication.model';
import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { RouteOfAdministration } from '../../../core/models/route-of-administration.model';
import { MarkerCategory, MarkerType } from '../../../core/models/marker.model';
import { IndicationService } from '../../../core/services/indication.service';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../../core/services/route-of-administration.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import {
  MarkerCategoryInUseError,
  MarkerCategoryService,
} from '../../../core/services/marker-category.service';
import { IndicationFormComponent } from '../therapeutic-areas/therapeutic-area-form.component';
import { MechanismOfActionFormComponent } from '../mechanisms-of-action/mechanism-of-action-form.component';
import { RouteOfAdministrationFormComponent } from '../routes-of-administration/route-of-administration-form.component';
import { EventTypeFormComponent } from '../event-types/event-type-form.component';
import { EventCategoryFormComponent } from '../event-categories/event-category-form.component';
import { MarkerIconComponent } from '../../../shared/components/svg-icons/marker-icon.component';
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
import { categoriesSorted, isSystemTaxonomyRow } from './taxonomy-tabs.logic';

type TabValue = 'indications' | 'moa' | 'roa' | 'event-categories' | 'event-types';

const TAB_VALUES: TabValue[] = ['indications', 'moa', 'roa', 'event-categories', 'event-types'];

@Component({
  selector: 'app-taxonomies-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TableModule,
    ButtonModule,
    SelectButton,
    Dialog,
    MessageModule,
    IndicationFormComponent,
    MechanismOfActionFormComponent,
    RouteOfAdministrationFormComponent,
    EventTypeFormComponent,
    EventCategoryFormComponent,
    MarkerIconComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    HighlightPipe,
  ],
  templateUrl: './taxonomies-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxonomiesPageComponent implements OnInit, OnDestroy {
  // Template-callable predicate for the system (read-only) row gate.
  protected readonly isSystemRow = isSystemTaxonomyRow;

  // Tab state
  readonly tabOptions: { label: string; value: TabValue }[] = [
    { label: 'Indications', value: 'indications' },
    { label: 'MOA', value: 'moa' },
    { label: 'ROA', value: 'roa' },
    { label: 'Event Categories', value: 'event-categories' },
    { label: 'Event Types', value: 'event-types' },
  ];

  readonly activeTab = signal<TabValue>('indications');

  // Shared state
  readonly loading = signal(false);
  readonly deleteError = signal<string | null>(null);

  // Therapeutic area state
  readonly areas = signal<Indication[]>([]);
  readonly taModalOpen = signal(false);
  readonly editingArea = signal<Indication | null>(null);
  private readonly areaMenuCache = new Map<string, MenuItem[]>();

  // MOA state
  readonly moas = signal<MechanismOfAction[]>([]);
  readonly moaModalOpen = signal(false);
  readonly editingMoa = signal<MechanismOfAction | null>(null);
  private readonly moaMenuCache = new Map<string, MenuItem[]>();

  // ROA state
  readonly roas = signal<RouteOfAdministration[]>([]);
  readonly roaModalOpen = signal(false);
  readonly editingRoa = signal<RouteOfAdministration | null>(null);
  private readonly roaMenuCache = new Map<string, MenuItem[]>();

  // Event category state
  readonly eventCategories = signal<MarkerCategory[]>([]);
  readonly sortedCategories = computed(() => categoriesSorted(this.eventCategories()));
  readonly ecModalOpen = signal(false);
  readonly editingCategory = signal<MarkerCategory | null>(null);
  private readonly ecMenuCache = new Map<string, MenuItem[]>();

  // Event type state
  readonly eventTypes = signal<MarkerType[]>([]);
  readonly etModalOpen = signal(false);
  readonly editingType = signal<MarkerType | null>(null);
  private readonly etMenuCache = new Map<string, MenuItem[]>();

  readonly grid = createGridState<MarkerType>({
    columns: [
      { field: 'name', header: 'Name', filter: { kind: 'text' } },
      { field: 'marker_categories.name', header: 'Category', filter: { kind: 'text' } },
      { field: 'shape', header: 'Shape', filter: { kind: 'text' } },
      { field: 'fill_style', header: 'Fill', filter: { kind: 'text' } },
      {
        field: 'is_system',
        header: 'Origin',
        filter: { kind: 'text' },
        getValue: (mt) => (isSystemTaxonomyRow(mt) ? 'system' : 'custom'),
      },
    ],
    globalSearchFields: ['name', 'marker_categories.name', 'shape', 'fill_style'],
    defaultSort: { field: 'name', order: 1 },
    persistenceKey: 'taxonomies-event-types',
  });

  readonly visibleEventTypes = this.grid.filteredRows(this.eventTypes);

  // Services
  private readonly areaService = inject(IndicationService);
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);
  private readonly typeService = inject(MarkerTypeService);
  private readonly categoryService = inject(MarkerCategoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  private spaceId = '';

  private readonly actionEffect = effect(() => {
    if (this.spaceRole.canEdit()) {
      this.topbarState.actions.set([
        {
          label: this.addButtonLabel(),
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
    this.topbarState.recordCount.set(String(this.activeCount() || ''));
  });

  constructor() {
    const tabParam = this.route.snapshot.queryParamMap.get('tab') as TabValue | null;
    if (tabParam && TAB_VALUES.includes(tabParam)) {
      this.activeTab.set(tabParam);
    }
  }

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadActiveTab();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  // --- Computed display helpers ---

  protected taxonomiesGuideLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    return ['/t', tenantId, 's', this.spaceId, 'help', 'taxonomies'];
  }

  protected markersHelpLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    return ['/t', tenantId, 's', this.spaceId, 'help', 'markers'];
  }

  addButtonLabel(): string {
    switch (this.activeTab()) {
      case 'indications':
        return 'Add indication';
      case 'moa':
        return 'Add mechanism';
      case 'roa':
        return 'Add route';
      case 'event-categories':
        return 'Add category';
      case 'event-types':
        return 'Add event type';
    }
  }

  activeCount(): number {
    switch (this.activeTab()) {
      case 'indications':
        return this.areas().length;
      case 'moa':
        return this.moas().length;
      case 'roa':
        return this.roas().length;
      case 'event-categories':
        return this.eventCategories().length;
      case 'event-types':
        return this.grid.totalRecords();
    }
  }

  // --- Tab switching ---

  onTabChange(value: TabValue): void {
    this.activeTab.set(value);
    this.deleteError.set(null);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.loadActiveTab();
  }

  // --- Row menus ---

  areaRowMenu(area: Indication): MenuItem[] {
    const cached = this.areaMenuCache.get(area.id);
    if (cached && cached.length > 0) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => this.openEditAreaModal(area),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.confirmDeleteArea(area),
        }
      );
      // Only cache once populated; otherwise a row that renders before
      // SpaceRoleService.fetchRole resolves would lock in an empty menu.
      this.areaMenuCache.set(area.id, items);
    }
    return items;
  }

  moaRowMenu(item: MechanismOfAction): MenuItem[] {
    const cached = this.moaMenuCache.get(item.id);
    if (cached && cached.length > 0) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => this.openEditMoaModal(item),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.confirmDeleteMoa(item),
        }
      );
      this.moaMenuCache.set(item.id, items);
    }
    return items;
  }

  roaRowMenu(item: RouteOfAdministration): MenuItem[] {
    const cached = this.roaMenuCache.get(item.id);
    if (cached && cached.length > 0) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => this.openEditRoaModal(item),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.confirmDeleteRoa(item),
        }
      );
      this.roaMenuCache.set(item.id, items);
    }
    return items;
  }

  eventCategoryRowMenu(item: MarkerCategory): MenuItem[] {
    // System rows are read-only: never surface an actions menu for them.
    if (this.isSystemRow(item)) return [];
    const cached = this.ecMenuCache.get(item.id);
    if (cached && cached.length > 0) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => this.openEditCategoryModal(item),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.confirmDeleteCategory(item),
        }
      );
      this.ecMenuCache.set(item.id, items);
    }
    return items;
  }

  eventTypeRowMenu(item: MarkerType): MenuItem[] {
    // System rows are read-only: never surface an actions menu for them.
    if (this.isSystemRow(item)) return [];
    const cached = this.etMenuCache.get(item.id);
    if (cached && cached.length > 0) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => this.openEditTypeModal(item),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.confirmDeleteType(item),
        }
      );
      this.etMenuCache.set(item.id, items);
    }
    return items;
  }

  // --- Modal open/close ---

  openCreateModal(): void {
    switch (this.activeTab()) {
      case 'indications':
        this.editingArea.set(null);
        this.taModalOpen.set(true);
        break;
      case 'moa':
        this.editingMoa.set(null);
        this.moaModalOpen.set(true);
        break;
      case 'roa':
        this.editingRoa.set(null);
        this.roaModalOpen.set(true);
        break;
      case 'event-categories':
        this.editingCategory.set(null);
        this.ecModalOpen.set(true);
        break;
      case 'event-types':
        this.editingType.set(null);
        this.etModalOpen.set(true);
        break;
    }
  }

  openEditAreaModal(area: Indication): void {
    this.editingArea.set(area);
    this.taModalOpen.set(true);
  }

  openEditMoaModal(item: MechanismOfAction): void {
    this.editingMoa.set(item);
    this.moaModalOpen.set(true);
  }

  openEditRoaModal(item: RouteOfAdministration): void {
    this.editingRoa.set(item);
    this.roaModalOpen.set(true);
  }

  openEditCategoryModal(item: MarkerCategory): void {
    this.editingCategory.set(item);
    this.ecModalOpen.set(true);
  }

  openEditTypeModal(item: MarkerType): void {
    this.editingType.set(item);
    this.etModalOpen.set(true);
  }

  closeModal(): void {
    this.taModalOpen.set(false);
    this.editingArea.set(null);
    this.moaModalOpen.set(false);
    this.editingMoa.set(null);
    this.roaModalOpen.set(false);
    this.editingRoa.set(null);
    this.ecModalOpen.set(false);
    this.editingCategory.set(null);
    this.etModalOpen.set(false);
    this.editingType.set(null);
  }

  // --- Save handlers ---

  async onAreaSaved(): Promise<void> {
    const isEdit = !!this.editingArea();
    this.closeModal();
    await this.loadAreas();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Therapeutic area updated.' : 'Therapeutic area created.',
      life: 3000,
    });
  }

  async onMoaSaved(): Promise<void> {
    const isEdit = !!this.editingMoa();
    this.closeModal();
    await this.loadMoas();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Mechanism of action updated.' : 'Mechanism of action created.',
      life: 3000,
    });
  }

  async onRoaSaved(): Promise<void> {
    const isEdit = !!this.editingRoa();
    this.closeModal();
    await this.loadRoas();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Route of administration updated.' : 'Route of administration created.',
      life: 3000,
    });
  }

  async onCategorySaved(): Promise<void> {
    const isEdit = !!this.editingCategory();
    this.closeModal();
    await this.loadEventCategories();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Event category updated.' : 'Event category created.',
      life: 3000,
    });
  }

  async onTypeSaved(): Promise<void> {
    const isEdit = !!this.editingType();
    this.closeModal();
    await this.loadEventTypes();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Event type updated.' : 'Event type created.',
      life: 3000,
    });
  }

  // --- Delete handlers ---

  async confirmDeleteArea(area: Indication): Promise<void> {
    // Cascade-safety T6 makes trials.indication_id ON DELETE SET NULL;
    // trials survive and render (uncategorized). Friction-only confirmation.
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete indication',
      entityLabel: area.name,
      message: `Delete "${area.name}"? Trials in this indication survive with no indication; they will render as (uncategorized).`,
      requireTypedConfirmation: true,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.areaService.delete(area.id);
      await this.loadAreas();
      this.messageService.add({
        severity: 'success',
        summary: 'Indication deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete indication. It may have associated trials.'
      );
    }
  }

  async confirmDeleteMoa(item: MechanismOfAction): Promise<void> {
    // MoA delete has no preview RPC; product joins are unlinked rather
    // than cascaded. Friction-only confirmation.
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete mechanism of action',
      entityLabel: item.name,
      message: `Delete "${item.name}"? Assets that reference this MoA will lose the association.`,
      requireTypedConfirmation: true,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.moaService.delete(item.id);
      await this.loadMoas();
      this.messageService.add({
        severity: 'success',
        summary: 'Mechanism of action deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete mechanism of action. It may be assigned to assets.'
      );
    }
  }

  async confirmDeleteRoa(item: RouteOfAdministration): Promise<void> {
    // RoA delete has no preview RPC; product joins are unlinked rather
    // than cascaded. Friction-only confirmation.
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete route of administration',
      entityLabel: item.name,
      message: `Delete "${item.name}"? Assets that reference this RoA will lose the association.`,
      requireTypedConfirmation: true,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.roaService.delete(item.id);
      await this.loadRoas();
      this.messageService.add({
        severity: 'success',
        summary: 'Route of administration deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete route of administration. It may be assigned to assets.'
      );
    }
  }

  async confirmDeleteCategory(item: MarkerCategory): Promise<void> {
    if (this.isSystemRow(item)) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete event category',
      entityLabel: item.name,
      message: `Delete "${item.name}"? Event types in this category must be reassigned first.`,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.categoryService.delete(item.id);
      await this.loadEventCategories();
      this.messageService.add({
        severity: 'success',
        summary: 'Event category deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof MarkerCategoryInUseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not delete event category.'
      );
    }
  }

  async confirmDeleteType(item: MarkerType): Promise<void> {
    if (this.isSystemRow(item)) return;
    // Event types have no preview RPC: existing markers survive but lose their
    // type linkage. Friction-only confirmation.
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete event type',
      entityLabel: item.name,
      message: `Delete "${item.name}"? Existing markers using this type will lose their type assignment.`,
      requireTypedConfirmation: true,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.typeService.delete(item.id);
      await this.loadEventTypes();
      this.messageService.add({
        severity: 'success',
        summary: 'Event type deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete event type. Check your connection and try again.'
      );
    }
  }

  // --- Data loading ---

  private async loadActiveTab(): Promise<void> {
    switch (this.activeTab()) {
      case 'indications':
        await this.loadAreas();
        break;
      case 'moa':
        await this.loadMoas();
        break;
      case 'roa':
        await this.loadRoas();
        break;
      case 'event-categories':
        await this.loadEventCategories();
        break;
      case 'event-types':
        await this.loadEventTypes();
        break;
    }
  }

  private async loadAreas(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.areaService.list(this.spaceId);
      this.areas.set(data);
      this.areaMenuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }

  private async loadMoas(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.moaService.list(this.spaceId);
      this.moas.set(data);
      this.moaMenuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }

  private async loadRoas(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.roaService.list(this.spaceId);
      this.roas.set(data);
      this.roaMenuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEventCategories(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.categoryService.list(this.spaceId);
      this.eventCategories.set(data);
      this.ecMenuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEventTypes(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.typeService.list(this.spaceId);
      this.eventTypes.set(data);
      this.etMenuCache.clear();
    } catch {
      // Silently handle
    } finally {
      this.loading.set(false);
    }
  }
}
