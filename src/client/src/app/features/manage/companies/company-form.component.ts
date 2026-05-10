import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Company } from '../../../core/models/company.model';
import { CompanyService } from '../../../core/services/company.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-company-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './company-form.component.html',
})
export class CompanyFormComponent implements OnInit {
  readonly company = input<Company | null>(null);

  saved = output<Company>();
  cancelled = output<void>();

  readonly name = signal('');
  readonly logoUrl = signal('');
  readonly displayOrder = signal(0);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly nameBlurred = signal(false);

  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const c = this.company();
    if (c) {
      this.name.set(c.name);
      this.logoUrl.set(c.logo_url ?? '');
      this.displayOrder.set(c.display_order);
    }
  }

  get isEdit(): boolean {
    return this.company() !== null;
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
      const payload: Partial<Company> = {
        name: this.name().trim(),
        logo_url: this.logoUrl().trim() || null,
        display_order: this.displayOrder(),
      };

      let result: Company;
      const existing = this.company();
      if (existing) {
        result = await this.companyService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        result = await this.companyService.create(spaceId, payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not save company. Check your connection and try again.'
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
