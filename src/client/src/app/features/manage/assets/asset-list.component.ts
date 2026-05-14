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
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Asset } from '../../../core/models/asset.model';
import { Company } from '../../../core/models/company.model';
import { AssetService } from '../../../core/services/asset.service';
import { CompanyService } from '../../../core/services/company.service';
import { TrialService } from '../../../core/services/trial.service';
import { AssetFormComponent } from './asset-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { TableSkeletonBodyComponent } from '../../../shared/components/skeleton/table-skeleton-body.component';
import { HighlightPipe } from '../../../shared/pipes/highlight.pipe';
import { buildFilterQueryParams, createGridState } from '../../../shared/grids';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

interface AssetRow {
  readonly asset: Asset;
  readonly companyName: string;
  readonly trialCount: number;
}

@Component({
  selector: 'app-asset-list',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    SelectModule,
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    AssetFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    HighlightPipe,
  ],
  templateUrl: './asset-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetListComponent implements OnInit, OnDestroy {
  readonly assets = signal<Asset[]>([]);
  readonly companies = signal<Company[]>([]);
  readonly trialCounts = signal<Record<string, number>>({});
  readonly loading = signal(false);
  readonly modalOpen = signal(false);
  readonly editingAsset = signal<Asset | null>(null);
  readonly deleteError = signal<string | null>(null);

  private assetService = inject(AssetService);
  private companyService = inject(CompanyService);
  private trialService = inject(TrialService);
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
          label: 'Add asset',
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

  private readonly menuCache = new Map<string, MenuItem[]>();

  readonly rows = computed<AssetRow[]>(() => {
    const companyMap = new Map(this.companies().map((c) => [c.id, c]));
    const counts = this.trialCounts();
    return this.assets().map((asset) => ({
      asset,
      companyName: companyMap.get(asset.company_id)?.name ?? '--',
      trialCount: counts[asset.id] ?? 0,
    }));
  });

  readonly grid = createGridState<AssetRow>({
    columns: [
      { field: 'asset.name', header: 'Name', filter: { kind: 'text' } },
      { field: 'asset.generic_name', header: 'Generic', filter: { kind: 'text' } },
      {
        field: 'asset.company_id',
        header: 'Company',
        filter: {
          kind: 'select',
          options: () => this.companies().map((c) => ({ label: c.name, value: c.id })),
        },
      },
      { field: 'trialCount', header: 'Trials', filter: { kind: 'numeric' } },
      { field: 'asset.display_order', header: 'Order' },
    ],
    globalSearchFields: ['asset.name', 'asset.generic_name', 'companyName'],
    defaultSort: { field: 'asset.display_order', order: 1 },
  });

  readonly visibleRows = this.grid.filteredRows(this.rows);

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;

    // Capture ?selected=<id> BEFORE loadData() runs because the grid's
    // URL-sync effect rewrites query params with its own state during init.
    const selectedId = this.route.snapshot.queryParamMap.get('selected');

    await this.loadData();

    if (selectedId) {
      const target = this.assets().find((a) => a.id === selectedId);
      if (target) {
        this.grid.onGlobalSearchInput(target.name);
      }
    }
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  rowMenu(row: AssetRow): MenuItem[] {
    const cached = this.menuCache.get(row.asset.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'View trials',
        icon: 'fa-solid fa-flask',
        command: () => this.openTrials(row.asset.id),
      },
    ];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => this.openEditModal(row.asset),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.confirmDelete(row.asset),
        }
      );
    }
    this.menuCache.set(row.asset.id, items);
    return items;
  }

  openCreateModal(): void {
    this.editingAsset.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(asset: Asset): void {
    this.editingAsset.set(asset);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingAsset.set(null);
  }

  async onSaved(): Promise<void> {
    const isEdit = !!this.editingAsset();
    this.closeModal();
    await this.loadData();
    this.messageService.add({
      severity: 'success',
      summary: isEdit ? 'Asset updated.' : 'Asset created.',
      life: 3000,
    });
  }

  openTrials(assetId: string): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'trials'], {
      queryParams: buildFilterQueryParams({
        'trial.product_id': { kind: 'select', values: [assetId] },
      }),
    });
  }

  async confirmDelete(asset: Asset): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete asset',
      message: `Delete "${asset.name}"? This cannot be undone.`,
      details: 'Associated trials are unlinked, not deleted.',
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.assetService.delete(asset.id);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Asset deleted.', life: 3000 });
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete asset. It may have associated trials.'
      );
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [assets, companies, trials] = await Promise.all([
        this.assetService.list(this.spaceId),
        this.companyService.list(this.spaceId),
        this.trialService.listBySpace(this.spaceId),
      ]);
      this.assets.set(assets);
      this.companies.set(companies);
      const counts: Record<string, number> = {};
      for (const trial of trials) {
        counts[trial.product_id] = (counts[trial.product_id] ?? 0) + 1;
      }
      this.trialCounts.set(counts);
      this.menuCache.clear();
    } catch {
      // Silently handle - empty list shown
    } finally {
      this.loading.set(false);
    }
  }
}
