import { Component, effect, inject, OnInit, output, signal } from '@angular/core';

import { DashboardFilters } from '../../../core/models/dashboard.model';
import { CompanyService } from '../../../core/services/company.service';
import { ProductService } from '../../../core/services/product.service';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import {
  MultiSelectComponent,
  MultiSelectOption,
} from '../../../shared/components/multi-select/multi-select.component';

@Component({
  selector: 'app-filter-panel',
  standalone: true,
  imports: [MultiSelectComponent],
  templateUrl: './filter-panel.component.html',
})
export class FilterPanelComponent implements OnInit {
  private companyService = inject(CompanyService);
  private productService = inject(ProductService);
  private therapeuticAreaService = inject(TherapeuticAreaService);

  filtersChange = output<DashboardFilters>();

  loading = signal(true);
  companyOptions = signal<MultiSelectOption[]>([]);
  productOptions = signal<MultiSelectOption[]>([]);
  taOptions = signal<MultiSelectOption[]>([]);

  selectedCompanyIds = signal<string[]>([]);
  selectedProductIds = signal<string[]>([]);
  selectedTAIds = signal<string[]>([]);
  startYear = signal<number | null>(null);
  endYear = signal<number | null>(null);

  constructor() {
    effect(() => {
      const filters: DashboardFilters = {
        companyIds: this.selectedCompanyIds().length > 0 ? this.selectedCompanyIds() : null,
        productIds: this.selectedProductIds().length > 0 ? this.selectedProductIds() : null,
        therapeuticAreaIds: this.selectedTAIds().length > 0 ? this.selectedTAIds() : null,
        startYear: this.startYear(),
        endYear: this.endYear(),
      };
      this.filtersChange.emit(filters);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const [companies, products, areas] = await Promise.all([
        this.companyService.list(),
        this.productService.list(),
        this.therapeuticAreaService.list(),
      ]);

      this.companyOptions.set(
        companies.map((c) => ({ id: c.id, name: c.name })),
      );
      this.productOptions.set(
        products.map((p) => ({ id: p.id, name: p.name })),
      );
      this.taOptions.set(
        areas.map((a) => ({ id: a.id, name: a.name })),
      );
    } finally {
      this.loading.set(false);
    }
  }

  onStartYearInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.startYear.set(value ? parseInt(value, 10) : null);
  }

  onEndYearInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.endYear.set(value ? parseInt(value, 10) : null);
  }
}
