import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Company } from '../../../core/models/company.model';
import { CompanyService } from '../../../core/services/company.service';
import { CompanyFormComponent } from './company-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { TableSkeletonBodyComponent } from '../../../shared/components/skeleton/table-skeleton-body.component';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { HighlightPipe } from '../../../shared/pipes/highlight.pipe';
import { buildFilterQueryParams, createGridState } from '../../../shared/grids';
import { buildEntityActionMenu } from '../../../shared/entity-actions/entity-action-menu';
import { runEntityDelete } from '../../../shared/entity-actions/run-entity-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

@Component({
  selector: 'app-company-list',
  standalone: true,
  imports: [
    RouterLink,
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    CompanyFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    BrandLogoComponent,
    HighlightPipe,
  ],
  templateUrl: './company-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyListComponent implements OnInit, OnDestroy {
  readonly companies = signal<Company[]>([]);
  readonly loading = signal(false);
  readonly modalOpen = signal(false);
  readonly editingCompany = signal<Company | null>(null);
  readonly deleteError = signal<string | null>(null);

  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  private readonly topbarActionsEffect = effect(() => {
    if (this.spaceRole.canEdit()) {
      this.topbarState.actions.set([
        {
          label: 'Add company',
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });
  spaceId = '';
  tenantId = '';

  readonly grid = createGridState<Company>({
    columns: [
      { field: 'name', header: 'Name', filter: { kind: 'text' } },
      { field: 'display_order', header: 'Order' },
    ],
    globalSearchFields: ['name'],
    defaultSort: { field: 'display_order', order: 1 },
    persistenceKey: 'manage-companies',
  });

  readonly visibleCompanies = this.grid.filteredRows(this.companies);

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  // Menu items are memoized per row-id so p-menu gets a stable reference on
  // every change-detection cycle. Without this, PrimeNG's popup menu swallows
  // the first click because the MenuItem[] is a new array every render.
  private readonly menuCache = new Map<string, MenuItem[]>();

  // canEdit() resolves async after SpaceRoleService fetches the role. When
  // rows render before that resolves, the cache fixes a menu without
  // Edit/Delete. Invalidate when the role flips so freshly built menus pick
  // up the new shape.
  private readonly menuCacheInvalidator = effect(() => {
    this.spaceRole.canEdit();
    this.menuCache.clear();
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    // Capture ?selected=<id> before loadData runs because the grid's URL-sync
    // effect rewrites query params with its own state during init.
    const selectedId = this.route.snapshot.queryParamMap.get('selected');
    await this.loadCompanies();
    if (selectedId) {
      const target = this.companies().find((c) => c.id === selectedId);
      if (target) {
        this.grid.onGlobalSearchInput(target.name);
      }
    }
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  openAssets(companyId: string): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'assets'], {
      queryParams: buildFilterQueryParams({
        'asset.company_id': { kind: 'select', values: [companyId] },
      }),
    });
  }

  rowMenu(company: Company): MenuItem[] {
    const cached = this.menuCache.get(company.id);
    if (cached) return cached;
    const items = buildEntityActionMenu({
      canEdit: this.spaceRole.canEdit(),
      editLabel: 'Edit',
      onEdit: () => this.openEditModal(company),
      onDelete: () => void this.confirmDelete(company),
      extras: [
        {
          label: 'View assets',
          icon: 'fa-solid fa-box',
          command: () => this.openAssets(company.id),
        },
      ],
    });
    this.menuCache.set(company.id, items);
    return items;
  }

  openCreateModal(): void {
    this.editingCompany.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(company: Company): void {
    this.editingCompany.set(company);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingCompany.set(null);
  }

  async onSaved(): Promise<void> {
    const isEdit = this.editingCompany() !== null;
    this.closeModal();
    await this.loadCompanies();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Company updated.' : 'Company created.',
      life: 3000,
    });
  }

  async confirmDelete(company: Company): Promise<void> {
    this.deleteError.set(null);
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete company',
        entityLabel: company.name,
        message: `Delete "${company.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.companyService.previewDelete(company.id),
      delete: () => this.companyService.delete(company.id),
      successSummary: 'Company deleted.',
      onSuccess: () => this.loadCompanies(),
      errorFallback: 'Could not delete company. It may have associated assets.',
    });
  }

  private async loadCompanies(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.companyService.list(this.spaceId);
      this.companies.set(data);
      this.menuCache.clear();
    } catch {
      // Silently handle - empty list shown
    } finally {
      this.loading.set(false);
    }
  }
}
