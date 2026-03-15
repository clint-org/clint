import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './product-form.component.html',
})
export class ProductFormComponent implements OnInit {
  product = input<Product | null>(null);

  saved = output<Product>();
  cancelled = output<void>();

  name = signal('');
  genericName = signal('');
  companyId = signal('');
  logoUrl = signal('');
  displayOrder = signal(0);
  submitting = signal(false);
  error = signal<string | null>(null);
  nameBlurred = signal(false);
  companies = signal<Company[]>([]);

  private productService = inject(ProductService);
  private companyService = inject(CompanyService);

  async ngOnInit(): Promise<void> {
    const p = this.product();
    if (p) {
      this.name.set(p.name);
      this.genericName.set(p.generic_name ?? '');
      this.companyId.set(p.company_id);
      this.logoUrl.set(p.logo_url ?? '');
      this.displayOrder.set(p.display_order);
    }

    try {
      const list = await this.companyService.list();
      this.companies.set(list);
      if (!p && list.length > 0) {
        this.companyId.set(list[0].id);
      }
    } catch {
      // Companies dropdown will be empty
    }
  }

  get isEdit(): boolean {
    return this.product() !== null;
  }

  get nameInvalid(): boolean {
    return this.nameBlurred() && this.name().trim().length === 0;
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    if (this.name().trim().length === 0) return;

    this.submitting.set(true);
    this.error.set(null);

    try {
      const payload: Partial<Product> = {
        name: this.name().trim(),
        generic_name: this.genericName().trim() || null,
        company_id: this.companyId(),
        logo_url: this.logoUrl().trim() || null,
        display_order: this.displayOrder(),
      };

      let result: Product;
      const existing = this.product();
      if (existing) {
        result = await this.productService.update(existing.id, payload);
      } else {
        result = await this.productService.create(payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save product');
    } finally {
      this.submitting.set(false);
    }
  }
}
