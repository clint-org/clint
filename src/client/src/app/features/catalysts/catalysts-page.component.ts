import { Component, computed, DestroyRef, effect, inject } from '@angular/core';
import { FlatCatalyst } from '../../core/models/catalyst.model';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { GridToolbarComponent } from '../../shared/components/grid-toolbar.component';
import { createGridState } from '../../shared/grids';
import { CatalystTableComponent } from './catalyst-table.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { LandscapeStateService } from '../landscape/landscape-state.service';

@Component({
  selector: 'app-catalysts-page',
  standalone: true,
  imports: [ManagePageShellComponent, GridToolbarComponent, CatalystTableComponent],
  templateUrl: './catalysts-page.component.html',
})
export class CatalystsPageComponent {
  readonly state = inject(LandscapeStateService);
  private readonly topbarState = inject(TopbarStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly grid = createGridState<FlatCatalyst>({
    columns: [
      { field: 'category_name', header: 'Category', filter: { kind: 'text' } },
      { field: 'company_name', header: 'Company', filter: { kind: 'text' } },
      { field: 'title', header: 'Catalyst', filter: { kind: 'text' } },
      { field: 'product_name', header: 'Product', filter: { kind: 'text' } },
    ],
    globalSearchFields: ['title', 'company_name', 'product_name', 'category_name'],
    defaultSort: { field: 'event_date', order: 1 },
    defaultPageSize: 10000,
  });

  readonly flatCatalysts = this.grid.filteredRows(computed(() => this.state.filteredCatalysts()));

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.topbarState.clear());
  }

  onRowClick(markerId: string): void {
    this.state.selectMarker(markerId);
  }
}
