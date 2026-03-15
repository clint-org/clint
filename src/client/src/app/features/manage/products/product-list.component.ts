import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';
import { ProductFormComponent } from './product-form.component';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [TableModule, ButtonModule, Dialog, MessageModule, ProductFormComponent],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnInit {
  products = signal<Product[]>([]);
  companies = signal<Company[]>([]);
  loading = signal(false);
  modalOpen = signal(false);
  editingProduct = signal<Product | null>(null);
  deleteError = signal<string | null>(null);

  private productService = inject(ProductService);
  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  spaceId = '';

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
      await this.loadData();
    } catch (err) {
      this.deleteError.set(err instanceof Error ? err.message : 'Failed to delete product');
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
