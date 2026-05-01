import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { MultiSelect } from 'primeng/multiselect';
import { Select } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { RouteOfAdministration } from '../../../core/models/route-of-administration.model';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../../core/services/route-of-administration.service';
import { extractConstraintMessage } from '../../../core/util/db-error';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  company_id: 'Company',
};

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    MultiSelect,
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
  moaOptions = signal<MechanismOfAction[]>([]);
  roaOptions = signal<RouteOfAdministration[]>([]);
  selectedMoaIds = signal<string[]>([]);
  selectedRoaIds = signal<string[]>([]);

  private productService = inject(ProductService);
  private companyService = inject(CompanyService);
  private moaService = inject(MechanismOfActionService);
  private roaService = inject(RouteOfAdministrationService);
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
      const [list, moas, roas] = await Promise.all([
        this.companyService.list(spaceId),
        this.moaService.list(spaceId),
        this.roaService.list(spaceId),
      ]);
      this.companies.set(list);
      this.moaOptions.set(moas);
      this.roaOptions.set(roas);
      if (!p && list.length > 0) {
        this.companyId.set(list[0].id);
      }
      if (p) {
        this.selectedMoaIds.set((p.mechanisms_of_action ?? []).map((m) => m.id));
        this.selectedRoaIds.set((p.routes_of_administration ?? []).map((r) => r.id));
      }
    } catch {
      // Dropdowns will be empty
    }
  }

  get isEdit(): boolean {
    return this.product() !== null;
  }

  get nameInvalid(): boolean {
    return this.nameBlurred() && this.name().trim().length === 0;
  }

  get canSubmit(): boolean {
    return this.name().trim().length > 0 && this.companyId().trim().length > 0;
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    if (!this.canSubmit) return;

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

      try {
        await Promise.all([
          this.productService.setMechanisms(result.id, this.selectedMoaIds()),
          this.productService.setRoutes(result.id, this.selectedRoaIds()),
        ]);
      } catch (e: unknown) {
        this.error.set(
          'Product saved but MOA/ROA assignment failed: ' +
            (e instanceof Error ? e.message : 'unknown error')
        );
        this.submitting.set(false);
        return;
      }
      this.saved.emit(result);
    } catch (err) {
      const constraint = extractConstraintMessage(err, PRODUCT_FIELD_LABELS);
      if (constraint) {
        this.error.set(constraint);
      } else {
        this.error.set(
          err instanceof Error
            ? err.message
            : 'Could not save product. Check your connection and try again.'
        );
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
