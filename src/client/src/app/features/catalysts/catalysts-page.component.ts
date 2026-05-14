import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Tooltip } from 'primeng/tooltip';
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
  imports: [
    ManagePageShellComponent,
    GridToolbarComponent,
    CatalystTableComponent,
    RouterLink,
    Tooltip,
  ],
  templateUrl: './catalysts-page.component.html',
  styles: [
    `
      /*
       * The catalysts page is a tall, naturally-flowing list inside
       * landscape-shell's bounded "overflow-hidden" container (which exists
       * to clip the bullseye/positioning/timeline visualizations). Make the
       * page host itself the desktop scroll container so list rows below
       * the fold are reachable. On mobile the whole height chain in
       * AppShell collapses to natural body scroll, so opt out there.
       */
      :host {
        display: block;
        height: 100%;
        min-height: 0;
        overflow-y: auto;
      }
      @media (max-width: 767px) {
        :host {
          height: auto;
          overflow-y: visible;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalystsPageComponent {
  readonly state = inject(LandscapeStateService);
  private readonly topbarState = inject(TopbarStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  readonly grid = createGridState<FlatCatalyst>({
    columns: [
      { field: 'category_name', header: 'Category', filter: { kind: 'text' } },
      { field: 'company_name', header: 'Company', filter: { kind: 'text' } },
      { field: 'title', header: 'Catalyst', filter: { kind: 'text' } },
      { field: 'product_name', header: 'Asset', filter: { kind: 'text' } },
    ],
    globalSearchFields: ['title', 'company_name', 'product_name', 'category_name'],
    defaultSort: { field: 'event_date', order: 1 },
    defaultPageSize: 10000,
  });

  readonly flatCatalysts = this.grid.filteredRows(computed(() => this.state.filteredCatalysts()));

  readonly markersHelpLink = computed<string[] | null>(() => {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    const spaceId = this.route.snapshot.paramMap.get('spaceId');
    if (!tenantId || !spaceId) return null;
    return ['/t', tenantId, 's', spaceId, 'help', 'markers'];
  });

  readonly categoryOptions = computed(() =>
    this.uniqueOptions(this.state.filteredCatalysts(), (c) => c.category_name)
  );

  readonly companyOptions = computed(() =>
    this.uniqueOptions(this.state.filteredCatalysts(), (c) => c.company_name)
  );

  private uniqueOptions(
    rows: FlatCatalyst[],
    pick: (c: FlatCatalyst) => string | null | undefined
  ): { label: string; value: string }[] {
    const seen = new Set<string>();
    const out: { label: string; value: string }[] = [];
    for (const row of rows) {
      const v = pick(row);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push({ label: v, value: v });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.topbarState.clear());

    // Honor ?markerId=<id> from the URL (command-palette deep link or
    // activity-feed row). openMarker (not selectMarker) so a previously
    // restored selection of the same marker does not toggle the drawer closed.
    const markerId = this.route.snapshot.queryParamMap.get('markerId');
    if (markerId) {
      void this.state.openMarker(markerId);
    }
  }

  onRowClick(markerId: string): void {
    this.state.selectMarker(markerId);
  }
}
