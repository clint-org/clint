import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
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
 *
 * The toolbar deliberately mirrors the materials browse surface (slate-50
 * stripe + mono labels + same density) so the two pages read as one
 * product surface, even though their filter controls differ.
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
  ],
  template: `
    <div class="page-shell">
      <header class="mb-4 flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
        <div>
          <h1 class="text-lg font-semibold text-slate-900">{{ headingTitle() }}</h1>
          <p class="text-xs text-slate-500">{{ headingSubtitle() }}</p>
        </div>
      </header>

      <div
        class="flex flex-wrap items-center gap-2 border border-slate-200 bg-slate-50/50 px-4 py-2"
        role="toolbar"
        aria-label="Intelligence filters"
      >
        <span
          class="font-mono text-[10px] uppercase tracking-wider text-slate-500"
          aria-hidden="true"
        >
          Status
        </span>
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
        <span class="ml-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          Search
        </span>
        <input
          pInputText
          type="search"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); resetAndLoad()"
          placeholder="Headline / thesis"
          aria-label="Search headline or thesis"
          class="!h-7 w-56 !text-xs"
        />
        <span class="ml-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          Entity
        </span>
        <p-multi-select
          [options]="entityTypeOptions"
          [ngModel]="entityTypes()"
          (ngModelChange)="entityTypes.set($event ?? []); resetAndLoad()"
          optionLabel="label"
          optionValue="value"
          placeholder="Any"
          ariaLabel="Filter by entity type"
          [showClear]="true"
          appendTo="body"
          [styleClass]="'w-fit' + (entityTypes().length ? ' has-value' : '')"
          size="small"
          [maxSelectedLabels]="0"
          [selectedItemsLabel]="'Entity (' + entityTypes().length + ')'"
        />
        <span class="ml-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          Since
        </span>
        <p-datepicker
          [ngModel]="since()"
          (ngModelChange)="since.set($event); resetAndLoad()"
          placeholder="Any time"
          dateFormat="yy-mm-dd"
          [showIcon]="true"
          [showClear]="true"
          size="small"
          appendTo="body"
        />
        @if (hasAnyActive()) {
          <p-button
            label="Clear"
            severity="secondary"
            [text]="true"
            size="small"
            (onClick)="onClearAll()"
          />
        }
        <span class="ml-auto font-mono text-[10px] tabular-nums text-slate-400">
          {{ totalLabel() }}
        </span>
      </div>

      <div class="border border-t-0 border-slate-200 bg-white" aria-live="polite">
        @if (loading()) {
          <ul aria-busy="true" aria-label="Loading reads" class="divide-y divide-slate-100">
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
          <p class="px-4 py-4 text-xs text-slate-400">{{ emptyMessage() }}</p>
        } @else {
          <app-intelligence-feed
            [rows]="rows()"
            [tenantId]="tenantId()"
            [spaceId]="spaceId()"
            [query]="query()"
          />
        }
      </div>

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
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    return this.query().trim().length > 0 || this.entityTypes().length > 0 || this.since() !== null;
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
