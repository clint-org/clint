import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Select } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    Select,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
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
  private route = inject(ActivatedRoute);

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
      const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
      const list = await this.companyService.list(spaceId);
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
        const sid = this.route.snapshot.paramMap.get('spaceId')!;
        result = await this.productService.create(sid, payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not save product. Check your connection and try again.'
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
