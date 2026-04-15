import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Trial } from '../../../core/models/trial.model';
import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';
import { TrialFormComponent } from './trial-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { createGridState } from '../../../shared/grids';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';

interface TrialRow {
  readonly trial: Trial;
  readonly productName: string;
  readonly companyName: string;
  readonly companyId: string;
  readonly phaseCount: number;
  readonly markerCount: number;
}

@Component({
  selector: 'app-trial-list',
  standalone: true,
  imports: [
    FormsModule,
    SelectModule,
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    TrialFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    GridToolbarComponent,
  ],
  templateUrl: './trial-list.component.html',
})
export class TrialListComponent implements OnInit, OnDestroy {
  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);

  spaceId = '';
  tenantId = '';

  private readonly menuCache = new Map<string, MenuItem[]>();

  trials = signal<Trial[]>([]);
  products = signal<Product[]>([]);
  companies = signal<Company[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  modalOpen = signal(false);
  editingTrial = signal<Trial | null>(null);

  readonly rows = computed<TrialRow[]>(() => {
    const productMap = new Map(this.products().map((p) => [p.id, p]));
    const companyMap = new Map(this.companies().map((c) => [c.id, c]));
    return this.trials().map((trial) => {
      const product = productMap.get(trial.product_id);
      const company = product ? companyMap.get(product.company_id) : undefined;
      return {
        trial,
        productName: product?.name ?? '--',
        companyName: company?.name ?? '--',
        companyId: company?.id ?? '',
        phaseCount: trial.phase_type ? 1 : 0,
        markerCount: trial.markers?.length ?? 0,
      };
    });
  });

  readonly grid = createGridState<TrialRow>({
    columns: [
      { field: 'trial.name', header: 'Trial', filter: { kind: 'text' } },
      { field: 'trial.identifier', header: 'NCT ID', filter: { kind: 'text' } },
      {
        field: 'trial.product_id',
        header: 'Product',
        filter: {
          kind: 'select',
          options: () => this.products().map((p) => ({ label: p.name, value: p.id })),
        },
      },
      {
        field: 'companyId',
        header: 'Company',
        filter: {
          kind: 'select',
          options: () => this.companies().map((c) => ({ label: c.name, value: c.id })),
        },
      },
      {
        field: 'trial.status',
        header: 'Status',
        filter: {
          kind: 'select',
          options: () => {
            const seen = new Set<string>();
            for (const t of this.trials()) if (t.status) seen.add(t.status);
            return Array.from(seen)
              .sort()
              .map((s) => ({ label: s, value: s }));
          },
        },
      },
      { field: 'phaseCount', header: 'Phases', filter: { kind: 'numeric' } },
      { field: 'markerCount', header: 'Markers', filter: { kind: 'numeric' } },
    ],
    globalSearchFields: [
      'trial.name',
      'trial.identifier',
      'productName',
      'companyName',
      'trial.status',
    ],
    defaultSort: { field: 'trial.name', order: 1 },
  });

  readonly visibleRows = this.grid.filteredRows(this.rows);

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  /**
   * If the user arrived via a deep-link with the product filter pre-applied
   * (e.g., from product-list "View trials"), the trial-form modal can pre-select
   * that product when opened. Reads the current product_id filter value out of
   * the grid state.
   */
  readonly preselectedProductId = computed<string | null>(() => {
    const filter = this.grid.filters()['trial.product_id'];
    if (filter?.kind === 'select' && filter.values.length > 0) {
      return String(filter.values[0]);
    }
    return null;
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.topbarState.actions.set([
      { label: 'Add trial', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() },
    ]);
    await this.loadData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  rowMenu(row: TrialRow): MenuItem[] {
    const cached = this.menuCache.get(row.trial.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Open detail',
        icon: 'fa-solid fa-arrow-up-right-from-square',
        command: () => this.openDetail(row.trial),
      },
      {
        label: 'Edit',
        icon: 'fa-solid fa-pen',
        command: () => this.openEditModal(row.trial),
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.confirmDelete(row.trial),
      },
    ];
    this.menuCache.set(row.trial.id, items);
    return items;
  }

  openCreateModal(): void {
    this.editingTrial.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(trial: Trial): void {
    this.editingTrial.set(trial);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingTrial.set(null);
  }

  async onSaved(): Promise<void> {
    const wasEditing = this.editingTrial() !== null;
    this.closeModal();
    await this.loadData();
    this.messageService.add({
      severity: 'success',
      summary: wasEditing ? 'Trial updated.' : 'Trial created.',
      life: 3000,
    });
  }

  openDetail(trial: Trial): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'trials', trial.id]);
  }

  async confirmDelete(trial: Trial): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete trial',
      message: `Delete "${trial.name}"? This cannot be undone.`,
    });
    if (!ok) return;
    this.error.set(null);
    try {
      await this.trialService.delete(trial.id);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Trial deleted.', life: 3000 });
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not delete trial. Check your connection and try again.'
      );
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [trials, products, companies] = await Promise.all([
        this.trialService.listBySpace(this.spaceId),
        this.productService.list(this.spaceId),
        this.companyService.list(this.spaceId),
      ]);
      this.trials.set(trials);
      this.products.set(products);
      this.companies.set(companies);
      this.menuCache.clear();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load trials');
    } finally {
      this.loading.set(false);
    }
  }
}
