import { Component, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';

import { DashboardFilters } from '../../../core/models/dashboard.model';
import { CompanyService } from '../../../core/services/company.service';
import { ProductService } from '../../../core/services/product.service';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-filter-panel',
  standalone: true,
  imports: [FormsModule, MultiSelect, ProgressSpinner],
  templateUrl: './filter-panel.component.html',
})
export class FilterPanelComponent implements OnInit {
  private companyService = inject(CompanyService);
  private productService = inject(ProductService);
  private therapeuticAreaService = inject(TherapeuticAreaService);

  spaceId = input.required<string>();
  filtersChange = output<DashboardFilters>();

  loading = signal(true);
  companyOptions = signal<SelectOption[]>([]);
  productOptions = signal<SelectOption[]>([]);
  taOptions = signal<SelectOption[]>([]);

  selectedCompanyIds = signal<string[]>([]);
  selectedProductIds = signal<string[]>([]);
  selectedTAIds = signal<string[]>([]);
  selectedStatuses = signal<string[]>([]);
  selectedStudyTypes = signal<string[]>([]);
  selectedPhases = signal<string[]>([]);

  readonly statusOptions: SelectOption[] = [
    { label: 'Not yet recruiting', value: 'Not yet recruiting' },
    { label: 'Recruiting', value: 'Recruiting' },
    { label: 'Active, not recruiting', value: 'Active, not recruiting' },
    { label: 'Completed', value: 'Completed' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Terminated', value: 'Terminated' },
    { label: 'Withdrawn', value: 'Withdrawn' },
  ];

  readonly studyTypeOptions: SelectOption[] = [
    { label: 'Interventional', value: 'Interventional' },
    { label: 'Observational', value: 'Observational' },
    { label: 'Expanded Access', value: 'Expanded Access' },
  ];

  readonly phaseOptions: SelectOption[] = [
    { label: 'Early Phase 1', value: 'Early Phase 1' },
    { label: 'Phase 1', value: 'Phase 1' },
    { label: 'Phase 2', value: 'Phase 2' },
    { label: 'Phase 3', value: 'Phase 3' },
    { label: 'Phase 4', value: 'Phase 4' },
    { label: 'N/A', value: 'N/A' },
  ];

  constructor() {
    effect(() => {
      const filters: DashboardFilters = {
        companyIds: this.selectedCompanyIds().length > 0 ? this.selectedCompanyIds() : null,
        productIds: this.selectedProductIds().length > 0 ? this.selectedProductIds() : null,
        therapeuticAreaIds: this.selectedTAIds().length > 0 ? this.selectedTAIds() : null,
        startYear: null,
        endYear: null,
        recruitmentStatuses: this.selectedStatuses().length > 0 ? this.selectedStatuses() : null,
        studyTypes: this.selectedStudyTypes().length > 0 ? this.selectedStudyTypes() : null,
        phases: this.selectedPhases().length > 0 ? this.selectedPhases() : null,
        mechanismOfActionIds: null,
        routeOfAdministrationIds: null,
      };
      this.filtersChange.emit(filters);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const sid = this.spaceId();
      const [companies, products, areas] = await Promise.all([
        this.companyService.list(sid),
        this.productService.list(sid),
        this.therapeuticAreaService.list(sid),
      ]);

      this.companyOptions.set(companies.map((c) => ({ label: c.name, value: c.id })));
      this.productOptions.set(products.map((p) => ({ label: p.name, value: p.id })));
      this.taOptions.set(areas.map((a) => ({ label: a.name, value: a.id })));
    } finally {
      this.loading.set(false);
    }
  }
}
