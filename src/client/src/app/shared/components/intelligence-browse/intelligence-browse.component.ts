import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { PaginatorModule } from 'primeng/paginator';
import { SelectButtonModule } from 'primeng/selectbutton';

import {
  IntelligenceEntityType,
  IntelligenceFeedRow,
} from '../../../core/models/primary-intelligence.model';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { IntelligenceFeedComponent } from '../intelligence-feed/intelligence-feed.component';
import { SkeletonComponent } from '../skeleton/skeleton.component';
import {
  BrowseFilterBarComponent,
  BrowseFilterChip,
} from '../browse-filter-bar/browse-filter-bar.component';

const ENTITY_TYPES: { label: string; value: IntelligenceEntityType }[] = [
  { label: 'Trial', value: 'trial' },
  { label: 'Marker', value: 'marker' },
  { label: 'Company', value: 'company' },
  { label: 'Product', value: 'product' },
  { label: 'Engagement', value: 'space' },
];

type StatusFilter = 'published' | 'drafts';

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: 'Published', value: 'published' },
  { label: 'Drafts', value: 'drafts' },
];

const PAGE_SIZE = 25;
// list_draft_intelligence_for_space takes a limit but no offset, so the
// drafts view fetches a single generous page and filters client-side.
const DRAFTS_LIMIT = 200;

/**
 * Filterable browse view for primary intelligence in the current space.
 * Toggle between Published (paginated, server-filtered) and Drafts
 * (single page, client-filtered, gated to agency members by RLS).
 */
@Component({
  selector: 'app-intelligence-browse',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    MultiSelectModule,
    DatePickerModule,
    PaginatorModule,
    SelectButtonModule,
    IntelligenceFeedComponent,
    SkeletonComponent,
    BrowseFilterBarComponent,
  ],
  template: `
    <div class="page-shell">
      <header class="mb-4 flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
        <div>
          <h1 class="text-lg font-semibold text-slate-900">{{ headingTitle() }}</h1>
          <p class="text-xs text-slate-500">{{ headingSubtitle() }}</p>
        </div>
      </header>

      <app-browse-filter-bar
        ariaLabel="Intelligence filters"
        [chips]="activeChips()"
        [hasActive]="hasAnyActive()"
        [resultLabel]="totalLabel()"
        (chipRemove)="onChipRemove($event)"
        (clearAll)="onClearAll()"
      >
        <p-selectbutton
          [options]="statusOptions"
          [ngModel]="status()"
          (ngModelChange)="onStatusChange($event)"
          optionLabel="label"
          optionValue="value"
          [allowEmpty]="false"
          size="small"
          aria-label="Filter by status"
        />
        <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
        <input
          pInputText
          type="search"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); resetAndLoad()"
          placeholder="Search headline / thesis"
          aria-label="Search"
          class="!h-8 w-64"
        />
        <p-multiSelect
          [options]="entityTypeOptions"
          [ngModel]="entityTypes()"
          (ngModelChange)="entityTypes.set($event ?? []); resetAndLoad()"
          optionLabel="label"
          optionValue="value"
          placeholder="Entity"
          ariaLabel="Filter by entity type"
          [showClear]="true"
          appendTo="body"
          [styleClass]="'w-fit' + (entityTypes().length ? ' has-value' : '')"
          size="small"
          [maxSelectedLabels]="0"
          [selectedItemsLabel]="'Entity (' + entityTypes().length + ')'"
        />
        <p-datepicker
          [ngModel]="since()"
          (ngModelChange)="since.set($event); resetAndLoad()"
          placeholder="Since..."
          dateFormat="yy-mm-dd"
          [showIcon]="true"
          [showClear]="true"
          size="small"
          appendTo="body"
        />
      </app-browse-filter-bar>

      <div class="mt-4">
        @if (loading()) {
          <ul
            class="divide-y divide-slate-100 border border-slate-200 bg-white"
            aria-busy="true"
            aria-label="Loading reads"
          >
            @for (i of skeletonRows; track i) {
              <li class="px-4 py-3" aria-hidden="true">
                <div class="mb-1 flex items-baseline gap-2">
                  <app-skeleton w="44px" h="14px" />
                  <app-skeleton w="220px" h="14px" />
                  <span class="ml-auto inline-flex">
                    <app-skeleton w="62px" h="10px" />
                  </span>
                </div>
                <div class="mt-1.5">
                  <app-skeleton [block]="true" w="100%" h="11px" />
                </div>
                <div class="mt-1">
                  <app-skeleton [block]="true" w="62%" h="11px" />
                </div>
                <div class="mt-2">
                  <app-skeleton w="84px" h="10px" />
                </div>
              </li>
            }
          </ul>
        } @else if (rows().length === 0) {
          <div class="border border-slate-200 bg-white px-4 py-8 text-center">
            <p class="text-xs text-slate-500">{{ emptyMessage() }}</p>
          </div>
        } @else {
          <app-intelligence-feed
            [rows]="rows()"
            [tenantId]="tenantId()"
            [spaceId]="spaceId()"
            [query]="query()"
          />

          @if (status() === 'published' && (total() > rows().length || offset() > 0)) {
            <div class="mt-4">
              <p-paginator
                [rows]="PAGE_SIZE"
                [totalRecords]="total()"
                [first]="offset()"
                (onPageChange)="onPage($event)"
              />
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class IntelligenceBrowseComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly intelligence = inject(PrimaryIntelligenceService);

  protected readonly PAGE_SIZE = PAGE_SIZE;
  protected readonly entityTypeOptions = ENTITY_TYPES;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly skeletonRows = [0, 1, 2, 3, 4];

  protected readonly tenantId = signal<string | null>(null);
  protected readonly spaceId = signal<string | null>(null);

  protected readonly status = signal<StatusFilter>('published');
  protected readonly query = signal<string>('');
  protected readonly entityTypes = signal<IntelligenceEntityType[]>([]);
  protected readonly since = signal<Date | null>(null);

  protected readonly rows = signal<IntelligenceFeedRow[]>([]);
  protected readonly total = signal<number>(0);
  protected readonly offset = signal<number>(0);
  protected readonly loading = signal<boolean>(false);

  protected readonly totalLabel = computed(() => {
    const t = this.total();
    if (this.status() === 'drafts') return t === 1 ? '1 draft' : `${t} drafts`;
    return t === 1 ? '1 read' : `${t} reads`;
  });

  protected readonly headingTitle = computed(() =>
    this.status() === 'drafts' ? 'Drafts' : 'Latest from Stout'
  );

  protected readonly headingSubtitle = computed(() =>
    this.status() === 'drafts'
      ? 'In-progress reads visible to your agency.'
      : 'All published reads in this engagement, recency-ordered.'
  );

  protected readonly emptyMessage = computed(() => {
    if (this.status() === 'drafts') return 'No drafts match the current filters.';
    return 'No published reads match the current filters.';
  });

  protected readonly hasAnyActive = computed(() => {
    return (
      this.query().trim().length > 0 ||
      this.entityTypes().length > 0 ||
      this.since() !== null
    );
  });

  protected readonly activeChips = computed<BrowseFilterChip[]>(() => {
    const chips: BrowseFilterChip[] = [];
    const q = this.query().trim();
    if (q) {
      chips.push({ field: 'query', header: 'Search', value: q, id: 'query' });
    }
    const entityLabels = new Map(ENTITY_TYPES.map((o) => [o.value, o.label]));
    for (const type of this.entityTypes()) {
      chips.push({
        field: 'entityTypes',
        header: 'Entity',
        value: entityLabels.get(type) ?? type,
        id: type,
      });
    }
    const sinceDate = this.since();
    if (sinceDate) {
      chips.push({
        field: 'since',
        header: 'Since',
        value: sinceDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        id: 'since',
      });
    }
    return chips;
  });

  // Re-fetch when the route's spaceId changes.
  private readonly routeEffect = effect(() => {
    const sid = this.spaceId();
    if (sid) {
      void this.load();
    }
  });

  ngOnInit(): void {
    this.tenantId.set(this.route.parent?.snapshot.paramMap.get('tenantId') ?? null);
    this.spaceId.set(this.route.parent?.snapshot.paramMap.get('spaceId') ?? null);
    const statusParam = this.route.snapshot.queryParamMap.get('status');
    if (statusParam === 'drafts' || statusParam === 'published') {
      this.status.set(statusParam);
    }
  }

  protected onStatusChange(next: StatusFilter): void {
    if (next === this.status()) return;
    this.status.set(next);
    this.offset.set(0);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: next === 'published' ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    void this.load();
  }

  protected resetAndLoad(): void {
    this.offset.set(0);
    void this.load();
  }

  protected onPage(event: { first?: number }): void {
    this.offset.set(event.first ?? 0);
    void this.load();
  }

  protected onChipRemove(chip: BrowseFilterChip): void {
    if (chip.field === 'query') {
      this.query.set('');
    } else if (chip.field === 'entityTypes') {
      this.entityTypes.update((types) =>
        types.filter((t) => t !== (chip.id as IntelligenceEntityType))
      );
    } else if (chip.field === 'since') {
      this.since.set(null);
    }
    this.resetAndLoad();
  }

  protected onClearAll(): void {
    this.query.set('');
    this.entityTypes.set([]);
    this.since.set(null);
    this.resetAndLoad();
  }

  private async load(): Promise<void> {
    const sid = this.spaceId();
    if (!sid) return;
    this.loading.set(true);
    try {
      if (this.status() === 'drafts') {
        const drafts = await this.intelligence.listDraftsForSpace(sid, DRAFTS_LIMIT);
        const filtered = this.applyClientFilters(drafts);
        this.rows.set(filtered);
        this.total.set(filtered.length);
        this.offset.set(0);
      } else {
        const result = await this.intelligence.list({
          spaceId: sid,
          entityTypes: this.entityTypes()?.length ? this.entityTypes() : null,
          since: this.since() ? this.since()!.toISOString() : null,
          query: this.query()?.trim() || null,
          limit: PAGE_SIZE,
          offset: this.offset(),
        });
        this.rows.set(result.rows);
        this.total.set(result.total);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private applyClientFilters(rows: IntelligenceFeedRow[]): IntelligenceFeedRow[] {
    const types = this.entityTypes() ?? [];
    const sinceDate = this.since();
    const q = this.query()?.trim().toLowerCase() ?? '';
    return rows.filter((row) => {
      if (types.length > 0 && !types.includes(row.entity_type)) return false;
      if (sinceDate && new Date(row.updated_at) < sinceDate) return false;
      if (q.length > 0) {
        const headline = row.headline?.toLowerCase() ?? '';
        const thesis = row.thesis_md?.toLowerCase() ?? '';
        if (!headline.includes(q) && !thesis.includes(q)) return false;
      }
      return true;
    });
  }
}
