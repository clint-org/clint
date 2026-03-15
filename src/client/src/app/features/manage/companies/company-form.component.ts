import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Company } from '../../../core/models/company.model';
import { CompanyService } from '../../../core/services/company.service';

@Component({
  selector: 'app-company-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './company-form.component.html',
})
export class CompanyFormComponent implements OnInit {
  company = input<Company | null>(null);

  saved = output<Company>();
  cancelled = output<void>();

  name = signal('');
  logoUrl = signal('');
  displayOrder = signal(0);
  submitting = signal(false);
  error = signal<string | null>(null);
  nameBlurred = signal(false);

  private companyService = inject(CompanyService);

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
        result = await this.companyService.create(payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save company');
    } finally {
      this.submitting.set(false);
    }
  }
}
