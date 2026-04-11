import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmationService, MenuItem } from 'primeng/api';
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
import { confirmDelete } from '../../../shared/utils/confirm-delete';

interface TrialRow {
  readonly trial: Trial;
  readonly productName: string;
  readonly companyName: string;
  readonly phaseCount: number;
  readonly markerCount: number;
}

@Component({
  selector: 'app-trial-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    TrialFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
  ],
  templateUrl: './trial-list.component.html',
})
export class TrialListComponent implements OnInit {
  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);

  spaceId = '';
  tenantId = '';

  // Stable menu-item references per row id (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  trials = signal<Trial[]>([]);
  products = signal<Product[]>([]);
  companies = signal<Company[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  // Optional product filter coming from ?product=<id> query param.
  productFilter = signal<string | null>(null);

  modalOpen = signal(false);
  editingTrial = signal<Trial | null>(null);

  readonly productLabel = computed(() => {
    const id = this.productFilter();
    if (!id) return null;
    return this.products().find((p) => p.id === id)?.name ?? null;
  });

  readonly rows = computed<TrialRow[]>(() => {
    const productMap = new Map(this.products().map((p) => [p.id, p]));
    const companyMap = new Map(this.companies().map((c) => [c.id, c]));
    const filter = this.productFilter();
    return this.trials()
      .filter((t) => !filter || t.product_id === filter)
      .map((trial) => {
        const product = productMap.get(trial.product_id);
        const company = product ? companyMap.get(product.company_id) : undefined;
        return {
          trial,
          productName: product?.name ?? '--',
          companyName: company?.name ?? '--',
          phaseCount: trial.trial_phases?.length ?? 0,
          markerCount: trial.trial_markers?.length ?? 0,
        };
      });
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.route.queryParamMap.subscribe((params) => {
      this.productFilter.set(params.get('product'));
    });
    await this.loadData();
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
    this.closeModal();
    await this.loadData();
  }

  openDetail(trial: Trial): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'trials', trial.id]);
  }

  clearFilter(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { product: null },
      queryParamsHandling: 'merge',
    });
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
