import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { SelectButton } from 'primeng/selectbutton';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { TherapeuticArea } from '../../../core/models/trial.model';
import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { RouteOfAdministration } from '../../../core/models/route-of-administration.model';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../../core/services/route-of-administration.service';
import { TherapeuticAreaFormComponent } from '../therapeutic-areas/therapeutic-area-form.component';
import { MechanismOfActionFormComponent } from '../mechanisms-of-action/mechanism-of-action-form.component';
import { RouteOfAdministrationFormComponent } from '../routes-of-administration/route-of-administration-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { TableSkeletonBodyComponent } from '../../../shared/components/skeleton/table-skeleton-body.component';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

type TabValue = 'therapeutic-areas' | 'moa' | 'roa';

@Component({
  selector: 'app-taxonomies-page',
  standalone: true,
  imports: [
    FormsModule,
    TableModule,
    ButtonModule,
    SelectButton,
    Dialog,
    MessageModule,
    TherapeuticAreaFormComponent,
    MechanismOfActionFormComponent,
    RouteOfAdministrationFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    TableSkeletonBodyComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="mb-4">
        <p-selectbutton
          [options]="tabOptions"
          [(ngModel)]="activeTabModel"
          optionLabel="label"
          optionValue="value"
          [allowEmpty]="false"
          size="small"
          (ngModelChange)="onTabChange($event)"
          aria-label="Select taxonomy type"
        />
      </div>

      <!-- Therapeutic Areas table -->
      @if (activeTab() === 'therapeutic-areas') {
        <p-table
          styleClass="data-table"
          [value]="areas()"
          [loading]="loading()"
          [tableStyle]="{ 'min-width': '40rem' }"
        >
          <ng-template #header>
            <tr>
              <th>Name</th>
              <th>Abbreviation</th>
              <th class="col-actions"></th>
            </tr>
          </ng-template>
          <ng-template #body let-area>
            <tr>
              <td>{{ area.name }}</td>
              <td class="col-identifier">{{ area.abbreviation ?? '--' }}</td>
              <td class="col-actions">
                <app-row-actions
                  [items]="areaRowMenu(area)"
                  [ariaLabel]="'Actions for ' + area.name"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template #loadingbody>
            <app-table-skeleton-body
              [cells]="[
                { w: '52%' },
                { w: '52px', h: '11px' },
                { w: '14px', class: 'col-actions' },
              ]"
            />
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="3">No therapeutic areas yet. Add one to get started.</td>
            </tr>
          </ng-template>
        </p-table>
      }

      <!-- Mechanisms of Action table -->
      @if (activeTab() === 'moa') {
        <p-table
          styleClass="data-table"
          [value]="moas()"
          [loading]="loading()"
          [tableStyle]="{ 'min-width': '36rem' }"
        >
          <ng-template #header>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th class="col-actions"></th>
            </tr>
          </ng-template>
          <ng-template #body let-item>
            <tr>
              <td>{{ item.name }}</td>
              <td class="col-identifier">{{ item.description ?? '--' }}</td>
              <td class="col-actions">
                <app-row-actions
                  [items]="moaRowMenu(item)"
                  [ariaLabel]="'Actions for ' + item.name"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template #loadingbody>
            <app-table-skeleton-body
              [cells]="[{ w: '42%' }, { w: '72%' }, { w: '14px', class: 'col-actions' }]"
            />
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="3">No mechanisms of action yet. Add one to get started.</td>
            </tr>
          </ng-template>
        </p-table>
      }

      <!-- Routes of Administration table -->
      @if (activeTab() === 'roa') {
        <p-table
          styleClass="data-table"
          [value]="roas()"
          [loading]="loading()"
          [tableStyle]="{ 'min-width': '36rem' }"
        >
          <ng-template #header>
            <tr>
              <th>Name</th>
              <th>Abbreviation</th>
              <th class="col-actions"></th>
            </tr>
          </ng-template>
          <ng-template #body let-item>
            <tr>
              <td>{{ item.name }}</td>
              <td class="col-identifier">{{ item.abbreviation ?? '--' }}</td>
              <td class="col-actions">
                <app-row-actions
                  [items]="roaRowMenu(item)"
                  [ariaLabel]="'Actions for ' + item.name"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template #loadingbody>
            <app-table-skeleton-body
              [cells]="[
                { w: '48%' },
                { w: '44px', h: '11px' },
                { w: '14px', class: 'col-actions' },
              ]"
            />
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="3">No routes of administration yet. Add one to get started.</td>
            </tr>
          </ng-template>
        </p-table>
      }

      @if (deleteError()) {
        <p-message severity="error" [closable]="false" styleClass="mt-4">
          {{ deleteError() }}
        </p-message>
      }
    </app-manage-page-shell>

    <!-- Therapeutic Area dialog -->
    <p-dialog
      [header]="editingArea() ? 'Edit therapeutic area' : 'Add therapeutic area'"
      [(visible)]="taModalOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
      (onHide)="closeModal()"
    >
      @if (taModalOpen()) {
        <app-therapeutic-area-form
          [area]="editingArea()"
          (saved)="onAreaSaved()"
          (cancelled)="closeModal()"
        />
      }
    </p-dialog>

    <!-- MOA dialog -->
    <p-dialog
      [header]="editingMoa() ? 'Edit mechanism of action' : 'Add mechanism of action'"
      [(visible)]="moaModalOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
      (onHide)="closeModal()"
    >
      @if (moaModalOpen()) {
        <app-mechanism-of-action-form
          [item]="editingMoa()"
          (saved)="onMoaSaved()"
          (cancelled)="closeModal()"
        />
      }
    </p-dialog>

    <!-- ROA dialog -->
    <p-dialog
      [header]="editingRoa() ? 'Edit route of administration' : 'Add route of administration'"
      [(visible)]="roaModalOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
      (onHide)="closeModal()"
    >
      @if (roaModalOpen()) {
        <app-route-of-administration-form
          [item]="editingRoa()"
          (saved)="onRoaSaved()"
          (cancelled)="closeModal()"
        />
      }
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxonomiesPageComponent implements OnInit, OnDestroy {
  // Tab state
  readonly tabOptions: { label: string; value: TabValue }[] = [
    { label: 'Therapeutic Areas', value: 'therapeutic-areas' },
    { label: 'MOA', value: 'moa' },
    { label: 'ROA', value: 'roa' },
  ];

  readonly activeTab = signal<TabValue>('therapeutic-areas');
  /** Two-way binding helper for p-selectbutton; kept in sync with activeTab signal. */
  activeTabModel: TabValue = 'therapeutic-areas';

  // Shared state
  readonly loading = signal(false);
  readonly deleteError = signal<string | null>(null);

  // Therapeutic area state
  readonly areas = signal<TherapeuticArea[]>([]);
  readonly taModalOpen = signal(false);
  readonly editingArea = signal<TherapeuticArea | null>(null);
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

  // Services
  private readonly areaService = inject(TherapeuticAreaService);
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);
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
    if (tabParam && ['therapeutic-areas', 'moa', 'roa'].includes(tabParam)) {
      this.activeTab.set(tabParam);
      this.activeTabModel = tabParam;
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

  pageTitle(): string {
    switch (this.activeTab()) {
      case 'therapeutic-areas':
        return 'Therapeutic areas';
      case 'moa':
        return 'Mechanisms of action';
      case 'roa':
        return 'Routes of administration';
    }
  }

  pageSubtitle(): string {
    switch (this.activeTab()) {
      case 'therapeutic-areas':
        return 'Disease areas used to tag trials and products.';
      case 'moa':
        return 'Ways a drug produces its therapeutic effect; used to classify programs and filter the landscape.';
      case 'roa':
        return 'Administration routes used to classify drug programs and filter the landscape.';
    }
  }

  addButtonLabel(): string {
    switch (this.activeTab()) {
      case 'therapeutic-areas':
        return 'Add therapeutic area';
      case 'moa':
        return 'Add mechanism';
      case 'roa':
        return 'Add route';
    }
  }

  activeCount(): number {
    switch (this.activeTab()) {
      case 'therapeutic-areas':
        return this.areas().length;
      case 'moa':
        return this.moas().length;
      case 'roa':
        return this.roas().length;
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

  areaRowMenu(area: TherapeuticArea): MenuItem[] {
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

  // --- Modal open/close ---

  openCreateModal(): void {
    switch (this.activeTab()) {
      case 'therapeutic-areas':
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
    }
  }

  openEditAreaModal(area: TherapeuticArea): void {
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

  closeModal(): void {
    this.taModalOpen.set(false);
    this.editingArea.set(null);
    this.moaModalOpen.set(false);
    this.editingMoa.set(null);
    this.roaModalOpen.set(false);
    this.editingRoa.set(null);
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

  // --- Delete handlers ---

  async confirmDeleteArea(area: TherapeuticArea): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete therapeutic area',
      message: `Delete "${area.name}"? This cannot be undone.`,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.areaService.delete(area.id);
      await this.loadAreas();
      this.messageService.add({
        severity: 'success',
        summary: 'Therapeutic area deleted.',
        life: 3000,
      });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete therapeutic area. It may have associated trials.'
      );
    }
  }

  async confirmDeleteMoa(item: MechanismOfAction): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete mechanism of action',
      message: `Delete "${item.name}"? This cannot be undone.`,
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
          : 'Could not delete mechanism of action. It may be assigned to products.'
      );
    }
  }

  async confirmDeleteRoa(item: RouteOfAdministration): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete route of administration',
      message: `Delete "${item.name}"? This cannot be undone.`,
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
          : 'Could not delete route of administration. It may be assigned to products.'
      );
    }
  }

  // --- Data loading ---

  private async loadActiveTab(): Promise<void> {
    switch (this.activeTab()) {
      case 'therapeutic-areas':
        await this.loadAreas();
        break;
      case 'moa':
        await this.loadMoas();
        break;
      case 'roa':
        await this.loadRoas();
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
}
