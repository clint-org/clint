import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import { Catalyst, FlatCatalyst, CatalystDetail } from '../../core/models/catalyst.model';
import { MarkerCategory } from '../../core/models/marker.model';
import { Company } from '../../core/models/company.model';
import { Product } from '../../core/models/product.model';
import { CatalystService } from '../../core/services/catalyst.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { CompanyService } from '../../core/services/company.service';
import { ProductService } from '../../core/services/product.service';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { GridToolbarComponent } from '../../shared/components/grid-toolbar.component';
import { createGridState } from '../../shared/grids';
import { CatalystTableComponent } from './catalyst-table.component';
import { MarkerDetailPanelComponent } from '../../shared/components/marker-detail-panel.component';
import { groupCatalystsByTimePeriod, flattenGroupedCatalysts } from './group-catalysts';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-catalysts-page',
  standalone: true,
  imports: [
    MessageModule,
    ProgressSpinner,
    ManagePageShellComponent,
    GridToolbarComponent,
    CatalystTableComponent,
    MarkerDetailPanelComponent,
  ],
  templateUrl: './catalysts-page.component.html',
  animations: [slidePanelAnimation],
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

  // Detail panel
  readonly selectedMarkerId = signal<string | null>(null);
  readonly selectedDetail = signal<CatalystDetail | null>(null);
  readonly detailLoading = signal(false);

  // Computed: filter options for column filters in the table
  readonly categoryOptions = computed(() =>
    this.markerCategories().map((c) => ({ label: c.name, value: c.name }))
  );

  readonly companyOptions = computed(() =>
    this.companies().map((c) => ({ label: c.name, value: c.name }))
  );

  // Grid state -- must be initialized in field initializer (injection context)
  readonly grid = createGridState<Catalyst>({
    columns: [
      {
        field: 'category_name',
        header: 'Category',
        filter: {
          kind: 'select',
          options: () => this.categoryOptions(),
        },
      },
      {
        field: 'company_name',
        header: 'Company',
        filter: {
          kind: 'select',
          options: () => this.companyOptions(),
        },
      },
      {
        field: 'title',
        header: 'Catalyst',
        filter: { kind: 'text' },
      },
      {
        field: 'product_name',
        header: 'Product',
        filter: { kind: 'text' },
      },
    ],
    globalSearchFields: ['title', 'company_name', 'product_name', 'category_name'],
    defaultSort: { field: 'event_date', order: 1 },
    // Large page size so all rows come through for time-bucket grouping
    defaultPageSize: 10000,
  });

  // All filtered (searched + column-filtered) catalysts, ungrouped
  private readonly filteredRaw = this.grid.filteredRows(this.rawCatalysts);

  // Group and flatten for the table's rowGroupMode
  readonly flatCatalysts = computed<FlatCatalyst[]>(() => {
    const groups = groupCatalystsByTimePeriod(this.filteredRaw());
    return flattenGroupedCatalysts(groups);
  });

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.getSpaceId();
    await this.loadInitialData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
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
