import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { PaginatorModule } from 'primeng/paginator';

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

const PAGE_SIZE = 25;

/**
 * Filterable browse view for all published primary intelligence in the
 * current space. Reuses `app-intelligence-feed` for the row rendering.
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
    IntelligenceFeedComponent,
    SkeletonComponent,
  ],
  template: `
    <div class="page-shell">
      <header class="mb-4 flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
        <div>
          <h1 class="text-lg font-semibold text-slate-900">Latest from Stout</h1>
          <p class="text-xs text-slate-500">
            All published reads in this engagement, recency-ordered.
          </p>
        </div>
        <span class="font-mono text-[10px] uppercase tracking-wider text-slate-400">
          {{ totalLabel() }}
        </span>
      </header>

      <section class="mb-4 flex flex-wrap items-center gap-2 border border-slate-200 bg-white p-3">
        <input
          pInputText
          type="search"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); resetAndLoad()"
          placeholder="Search headline / thesis"
          aria-label="Search"
          class="!h-9 w-72"
        />
        <p-multiSelect
          [options]="entityTypeOptions"
          [ngModel]="entityTypes()"
          (ngModelChange)="entityTypes.set($event ?? []); resetAndLoad()"
          optionLabel="label"
          optionValue="value"
          placeholder="Any entity type"
          [showClear]="true"
          styleClass="!h-9 w-56"
        />
        <p-datepicker
          [ngModel]="since()"
          (ngModelChange)="since.set($event); resetAndLoad()"
          placeholder="Since..."
          dateFormat="yy-mm-dd"
          [showIcon]="true"
          [showClear]="true"
        />
      </section>

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
      } @else {
        <app-intelligence-feed [rows]="rows()" [tenantId]="tenantId()" [spaceId]="spaceId()" />

        @if (total() > rows().length || offset() > 0) {
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
  `,
})
export class IntelligenceBrowseComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly intelligence = inject(PrimaryIntelligenceService);

  protected readonly PAGE_SIZE = PAGE_SIZE;
  protected readonly entityTypeOptions = ENTITY_TYPES;
  protected readonly skeletonRows = [0, 1, 2, 3, 4];

  protected readonly tenantId = signal<string | null>(null);
  protected readonly spaceId = signal<string | null>(null);

  protected readonly query = signal<string>('');
  protected readonly entityTypes = signal<IntelligenceEntityType[]>([]);
  protected readonly since = signal<Date | null>(null);

  protected readonly rows = signal<IntelligenceFeedRow[]>([]);
  protected readonly total = signal<number>(0);
  protected readonly offset = signal<number>(0);
  protected readonly loading = signal<boolean>(false);

  protected readonly totalLabel = computed(() => {
    const t = this.total();
    return t === 1 ? '1 read' : `${t} reads`;
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
  }

  protected resetAndLoad(): void {
    this.offset.set(0);
    void this.load();
  }

  protected onPage(event: { first?: number }): void {
    this.offset.set(event.first ?? 0);
    void this.load();
  }

  private async load(): Promise<void> {
    const sid = this.spaceId();
    if (!sid) return;
    this.loading.set(true);
    try {
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
    } finally {
      this.loading.set(false);
    }
  }
}
