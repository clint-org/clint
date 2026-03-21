import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { Trial } from '../../../core/models/trial.model';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';
import { TrialService } from '../../../core/services/trial.service';
import { ProductFormComponent } from './product-form.component';
import { TrialFormComponent } from '../trials/trial-form.component';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    ProductFormComponent,
    TrialFormComponent,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnInit {
  products = signal<Product[]>([]);
  companies = signal<Company[]>([]);
  loading = signal(false);
  modalOpen = signal(false);
  editingProduct = signal<Product | null>(null);
  deleteError = signal<string | null>(null);

  // Trial management
  expandedProductId = signal<string | null>(null);
  productTrials = signal<Trial[]>([]);
  trialsLoading = signal(false);
  trialModalOpen = signal(false);
  editingTrial = signal<Trial | null>(null);
  addingTrialForProductId = signal<string | null>(null);
  trialDeleteError = signal<string | null>(null);

  private productService = inject(ProductService);
  private companyService = inject(CompanyService);
  private trialService = inject(TrialService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  spaceId = '';

  get tenantId(): string {
    return this.route.snapshot.paramMap.get('tenantId') ?? '';
  }

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadData();
  }

  getCompanyName(companyId: string): string {
    const company = this.companies().find((c) => c.id === companyId);
    return company?.name ?? '-';
  }

  openCreateModal(): void {
    this.editingProduct.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(product: Product): void {
    this.editingProduct.set(product);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingProduct.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeModal();
    await this.loadData();
  }

  async confirmDelete(product: Product): Promise<void> {
    const confirmed = window.confirm(`Delete "${product.name}"? This action cannot be undone.`);
    if (!confirmed) return;

    this.deleteError.set(null);
    try {
      await this.productService.delete(product.id);
      if (this.expandedProductId() === product.id) {
        this.expandedProductId.set(null);
        this.productTrials.set([]);
      }
      await this.loadData();
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete product. It may have associated trials.'
      );
    }
  }

  // Trial management methods
  async toggleTrials(product: Product): Promise<void> {
    if (this.expandedProductId() === product.id) {
      this.expandedProductId.set(null);
      this.productTrials.set([]);
      return;
    }

    this.expandedProductId.set(product.id);
    await this.loadTrials(product.id);
  }

  async loadTrials(productId: string): Promise<void> {
    this.trialsLoading.set(true);
    try {
      const trials = await this.trialService.listByProduct(productId);
      this.productTrials.set(trials);
    } catch {
      this.productTrials.set([]);
    } finally {
      this.trialsLoading.set(false);
    }
  }

  openAddTrialModal(productId: string): void {
    this.addingTrialForProductId.set(productId);
    this.editingTrial.set(null);
    this.trialModalOpen.set(true);
  }

  openEditTrialModal(trial: Trial): void {
    this.editingTrial.set(trial);
    this.addingTrialForProductId.set(null);
    this.trialModalOpen.set(true);
  }

  closeTrialModal(): void {
    this.trialModalOpen.set(false);
    this.editingTrial.set(null);
    this.addingTrialForProductId.set(null);
  }

  async onTrialSaved(): Promise<void> {
    this.closeTrialModal();
    const expandedId = this.expandedProductId();
    if (expandedId) {
      await this.loadTrials(expandedId);
    }
  }

  navigateToTrial(trial: Trial): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'trials', trial.id]);
  }

  async confirmDeleteTrial(trial: Trial): Promise<void> {
    const confirmed = window.confirm(`Delete trial "${trial.name}"? This action cannot be undone.`);
    if (!confirmed) return;

    this.trialDeleteError.set(null);
    try {
      await this.trialService.delete(trial.id);
      const expandedId = this.expandedProductId();
      if (expandedId) {
        await this.loadTrials(expandedId);
      }
    } catch (err) {
      this.trialDeleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete trial. Check your connection and try again.'
      );
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [products, companies] = await Promise.all([
        this.productService.list(this.spaceId),
        this.companyService.list(this.spaceId),
      ]);
      this.products.set(products);
      this.companies.set(companies);
    } catch {
      // Silently handle - empty list shown
    } finally {
      this.loading.set(false);
    }
  }
}
