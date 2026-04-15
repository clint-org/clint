import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';

import { Catalyst, CatalystDetail, FlatCatalyst } from '../../core/models/catalyst.model';
import { MarkerCategory } from '../../core/models/marker.model';
import { Company } from '../../core/models/company.model';
import { Product } from '../../core/models/product.model';
import { CatalystService } from '../../core/services/catalyst.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { CompanyService } from '../../core/services/company.service';
import { ProductService } from '../../core/services/product.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { CatalystTableComponent } from './catalyst-table.component';
import { CatalystDetailPanelComponent } from './catalyst-detail-panel.component';
import { groupCatalystsByTimePeriod, flattenGroupedCatalysts } from './group-catalysts';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-catalysts-page',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MessageModule,
    MultiSelectModule,
    ProgressSpinner,
    SelectModule,
    InputTextModule,
    ManagePageShellComponent,
    CatalystTableComponent,
    CatalystDetailPanelComponent,
  ],
  templateUrl: './catalysts-page.component.html',
})
export class CatalystsPageComponent implements OnInit, OnDestroy {
  private catalystService = inject(CatalystService);
  private markerCategoryService = inject(MarkerCategoryService);
  private companyService = inject(CompanyService);
  private productService = inject(ProductService);
  private route = inject(ActivatedRoute);
  private readonly topbarState = inject(TopbarStateService);

  private spaceId = '';

  // Data
  readonly rawCatalysts = signal<Catalyst[]>([]);
  readonly markerCategories = signal<MarkerCategory[]>([]);
  readonly companies = signal<Company[]>([]);
  readonly products = signal<Product[]>([]);

  // UI state
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Server-side filters
  readonly selectedCategoryIds = signal<string[]>([]);
  readonly selectedCompanyId = signal<string | null>(null);
  readonly selectedProductId = signal<string | null>(null);

  // Client-side search
  readonly searchText = signal('');

  // Detail panel
  readonly selectedMarkerId = signal<string | null>(null);
  readonly selectedDetail = signal<CatalystDetail | null>(null);
  readonly detailLoading = signal(false);

  // Computed: filter options
  readonly categoryOptions = computed(() =>
    this.markerCategories().map((c) => ({ label: c.name, value: c.id }))
  );

  readonly companyOptions = computed(() =>
    this.companies().map((c) => ({ label: c.name, value: c.id }))
  );

  readonly filteredProductOptions = computed(() => {
    const companyId = this.selectedCompanyId();
    const prods = companyId
      ? this.products().filter((p) => p.company_id === companyId)
      : this.products();
    return prods.map((p) => ({ label: p.name, value: p.id }));
  });

  // Computed: apply client-side search, then group
  readonly filteredCatalysts = computed(() => {
    const search = this.searchText().toLowerCase().trim();
    if (!search) return this.rawCatalysts();
    return this.rawCatalysts().filter(
      (c) =>
        c.title.toLowerCase().includes(search) ||
        (c.company_name?.toLowerCase().includes(search) ?? false) ||
        (c.product_name?.toLowerCase().includes(search) ?? false) ||
        c.marker_type_name.toLowerCase().includes(search) ||
        c.category_name.toLowerCase().includes(search)
    );
  });

  readonly groups = computed(() => groupCatalystsByTimePeriod(this.filteredCatalysts()));

  readonly flatCatalysts = computed<FlatCatalyst[]>(() => flattenGroupedCatalysts(this.groups()));

  readonly totalCount = computed(() => this.rawCatalysts().length);

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.totalCount() || ''));
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.getSpaceId();
    await this.loadInitialData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  async onCategoryChange(ids: string[] | null): Promise<void> {
    this.selectedCategoryIds.set(ids ?? []);
    await this.loadCatalysts();
  }

  async onCompanyChange(companyId: string | null): Promise<void> {
    this.selectedCompanyId.set(companyId);
    // Clear product filter when company changes
    this.selectedProductId.set(null);
    await this.loadCatalysts();
  }

  async onProductChange(productId: string | null): Promise<void> {
    this.selectedProductId.set(productId);
    await this.loadCatalysts();
  }

  async onRowClick(markerId: string): Promise<void> {
    // Toggle: clicking the same row closes the panel
    if (this.selectedMarkerId() === markerId) {
      this.selectedMarkerId.set(null);
      this.selectedDetail.set(null);
      return;
    }

    this.selectedMarkerId.set(markerId);
    this.selectedDetail.set(null);
    this.detailLoading.set(true);

    try {
      const detail = await this.catalystService.getCatalystDetail(markerId);
      // Only apply if the same marker is still selected
      if (this.selectedMarkerId() === markerId) {
        this.selectedDetail.set(detail);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load catalyst detail.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  closePanel(): void {
    this.selectedMarkerId.set(null);
    this.selectedDetail.set(null);
  }

  async clearFilters(): Promise<void> {
    this.selectedCategoryIds.set([]);
    this.selectedCompanyId.set(null);
    this.selectedProductId.set(null);
    this.searchText.set('');
    await this.loadCatalysts();
  }

  private async loadInitialData(): Promise<void> {
    this.loading.set(true);
    try {
      const [catalysts, categories, companies, products] = await Promise.all([
        this.catalystService.getKeyCatalysts(this.spaceId),
        this.markerCategoryService.list(this.spaceId),
        this.companyService.list(this.spaceId),
        this.productService.list(this.spaceId),
      ]);
      this.rawCatalysts.set(catalysts);
      this.markerCategories.set(categories);
      this.companies.set(companies);
      this.products.set(products);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load catalysts.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadCatalysts(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const catalysts = await this.catalystService.getKeyCatalysts(this.spaceId, {
        category_ids: this.selectedCategoryIds().length ? this.selectedCategoryIds() : undefined,
        company_id: this.selectedCompanyId() ?? undefined,
        product_id: this.selectedProductId() ?? undefined,
      });
      this.rawCatalysts.set(catalysts);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load catalysts.');
    } finally {
      this.loading.set(false);
    }
  }

  private getSpaceId(): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('spaceId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }
}
