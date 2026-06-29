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
import { DatePickerModule } from 'primeng/datepicker';
import { PaginatorModule } from 'primeng/paginator';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MessageService } from 'primeng/api';

import { IntelligenceFeedRow } from '../../../core/models/primary-intelligence.model';
import {
  briefRowToFeedItem,
  FeedItem,
} from '../../../core/models/intelligence-feed-item.model';
import { CatalystDetail } from '../../../core/models/event-detail.model';
import { MarkerCategory } from '../../../core/models/marker.model';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { IntelligenceFeedService } from '../../../core/services/intelligence-feed.service';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { EventDetailService } from '../../../core/services/event-detail.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { SectionHeaderComponent } from '../section-header/section-header.component';
import { IntelligenceFeedComponent } from '../intelligence-feed/intelligence-feed.component';
import { MarkerDetailPanelComponent } from '../marker-detail-panel.component';
import { IntelligenceDrawerComponent } from '../intelligence-drawer/intelligence-drawer.component';
import {
  ComposeTarget,
  IntelligenceComposeDialogComponent,
} from '../intelligence-compose-dialog/intelligence-compose-dialog.component';
import { SkeletonComponent } from '../skeleton/skeleton.component';
import { parseDayOffset } from '../../utils/parse-day-offset';
import { buildFeedQuery, KindFilter } from './feed-query';

type StatusFilter = 'published' | 'drafts';

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: 'Published', value: 'published' },
  { label: 'Drafts', value: 'drafts' },
];

const KIND_OPTIONS: { label: string; value: KindFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Intelligence', value: 'intel' },
  { label: 'Events', value: 'event' },
];

const PAGE_SIZE = 25;
// list_draft_intelligence_for_space takes a limit but no offset, so the
// drafts view fetches a single generous page and filters client-side.
const DRAFTS_LIMIT = 200;

/**
 * The Intelligence feed: the one curated stream for the space. The Published
 * view is the unified briefs + events feed (list_intelligence_feed), recency
 * descending and NOT significance-gated; the Drafts view stays briefs-only
 * (events have no draft state) and is gated to agency members by RLS.
 *
 * The toolbar deliberately mirrors the materials browse surface (slate-50
 * stripe + mono labels + same density) so the pages read as one platform
 * surface. The Kind toggle (All / Intelligence / Events) selects which kinds
 * appear; the event-category chips filter the event subset only.
 */
@Component({
  selector: 'app-intelligence-browse',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    DatePickerModule,
    PaginatorModule,
    SelectButtonModule,
    SectionHeaderComponent,
    IntelligenceFeedComponent,
    MarkerDetailPanelComponent,
    IntelligenceComposeDialogComponent,
    IntelligenceDrawerComponent,
    SkeletonComponent,
  ],
  template: `
    <div class="page-shell">
      <app-section-header [label]="headingTitle()" [detail]="headingSubtitle()">
        @if (spaceRole.canAuthorIntelligence() && spaceId()) {
          <p-button
            actions
            label="Publish intelligence"
            icon="fa-solid fa-pen-nib"
            size="small"
            (onClick)="composeDialogOpen.set(true)"
          />
        }
      </app-section-header>

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
        @if (status() === 'published') {
          <span class="ml-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Show
          </span>
          <p-selectbutton
            [options]="kindOptions"
            [ngModel]="kind()"
            (ngModelChange)="onKindChange($event)"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
            size="small"
            aria-label="Filter by kind"
          />
        }
        <span class="ml-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          Search
        </span>
        <input
          pInputText
          type="search"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); resetAndLoad()"
          placeholder="Headline / title"
          aria-label="Search headline or title"
          class="!h-7 w-56 !text-xs"
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
        <span
          class="ml-auto font-mono text-[10px] font-bold uppercase tracking-wider tabular-nums text-slate-500"
        >
          {{ totalLabel() }}
        </span>
      </div>

      @if (status() === 'published' && kind() !== 'intel' && categoryOptions().length) {
        <div
          class="flex flex-wrap items-center gap-1.5 border border-t-0 border-slate-200 bg-slate-50/50 px-4 py-2"
          role="group"
          aria-label="Filter events by category"
        >
          <span class="mr-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Category
          </span>
          @for (c of categoryOptions(); track c.id) {
            <p-button
              [label]="c.name"
              size="small"
              [text]="!isCategoryActive(c.name)"
              [attr.aria-pressed]="isCategoryActive(c.name)"
              (onClick)="toggleCategory(c.name)"
            />
          }
        </div>
      }

      <div class="border border-t-0 border-slate-200 bg-white" aria-live="polite">
        @if (loading()) {
          <ul aria-busy="true" aria-label="Loading intelligence">
            @for (i of skeletonRows; track i) {
              <li class="flex border-b border-slate-100 last:border-b-0" aria-hidden="true">
                <span class="w-[3px] shrink-0 bg-slate-200"></span>
                <div class="min-w-0 flex-1 px-4 py-2">
                  <div class="flex items-center gap-2">
                    <app-skeleton w="48px" h="11px" />
                    <app-skeleton [block]="true" w="55%" h="13px" />
                    <span class="ml-auto inline-flex">
                      <app-skeleton w="64px" h="10px" />
                    </span>
                  </div>
                  <div class="mt-1 pl-[20px]">
                    <app-skeleton [block]="true" w="40%" h="10px" />
                  </div>
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
            (eventOpen)="onEventOpen($event)"
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

      <app-marker-detail-panel
        mode="page-drawer"
        [open]="eventPanelOpen()"
        [detail]="eventDetail()"
        [spaceId]="spaceId()"
        surfaceKey="timeline_detail"
        (panelClose)="closeEventPanel()"
        (eventClick)="onEventOpen($event)"
        (trialClick)="onTrialClick($event)"
      />

      @if (spaceId(); as sid) {
        <app-intelligence-compose-dialog
          [visible]="composeDialogOpen()"
          [spaceId]="sid"
          (cancelled)="composeDialogOpen.set(false)"
          (chosen)="onComposeChosen($event)"
        />
        @if (composeTarget(); as target) {
          <app-intelligence-drawer
            [visible]="drawerOpen()"
            [spaceId]="sid"
            [entityType]="target.entityType"
            [entityId]="target.entityId"
            [anchorId]="target.anchorId"
            (closed)="onDrawerClosed()"
            (published)="onIntelligencePublished()"
          />
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceBrowseComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly intelligence = inject(PrimaryIntelligenceService);
  private readonly feed = inject(IntelligenceFeedService);
  private readonly markerCategory = inject(MarkerCategoryService);
  private readonly eventDetailService = inject(EventDetailService);
  private readonly messageService = inject(MessageService);
  protected readonly spaceRole = inject(SpaceRoleService);

  protected readonly PAGE_SIZE = PAGE_SIZE;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly skeletonRows = [0, 1, 2, 3, 4];

  protected readonly tenantId = signal<string | null>(null);
  protected readonly spaceId = signal<string | null>(null);

  protected readonly status = signal<StatusFilter>('published');
  // Default to Intelligence (briefs): the curated read lands first; All / Events are
  // one click away. The feed RPC already excludes auto-derived CT.gov markers.
  protected readonly kind = signal<KindFilter>('intel');
  protected readonly query = signal<string>('');
  protected readonly categories = signal<string[]>([]);
  protected readonly categoryOptions = signal<MarkerCategory[]>([]);
  protected readonly since = signal<Date | null>(null);

  protected readonly rows = signal<FeedItem[]>([]);
  protected readonly total = signal<number>(0);
  protected readonly offset = signal<number>(0);
  protected readonly loading = signal<boolean>(false);

  // Event detail: an event-row click opens the shared marker/event detail panel
  // in place (read-only here; editing lives on the timeline / event surfaces).
  protected readonly eventDetail = signal<CatalystDetail | null>(null);
  protected readonly eventPanelOpen = signal<boolean>(false);

  // Compose flow: agency members pick an anchor entity, then author the intelligence
  // in the shared IntelligenceDrawerComponent.
  protected readonly composeDialogOpen = signal<boolean>(false);
  protected readonly drawerOpen = signal<boolean>(false);
  protected readonly composeTarget = signal<ComposeTarget | null>(null);

  protected readonly totalLabel = computed(() => {
    const t = this.total();
    if (this.status() === 'drafts') return t === 1 ? '1 draft' : `${t} drafts`;
    return t === 1 ? '1 entry' : `${t} entries`;
  });

  protected readonly headingTitle = computed(() =>
    this.status() === 'drafts' ? 'Drafts' : 'Latest from Stout'
  );

  protected readonly headingSubtitle = computed(() =>
    this.status() === 'drafts'
      ? 'In-progress intelligence visible to your agency.'
      : 'Intelligence and events in this space, most recent first.'
  );

  protected readonly emptyMessage = computed(() => {
    if (this.status() === 'drafts') return 'No drafts match the current filters.';
    switch (this.kind()) {
      case 'intel':
        return 'No published intelligence matches the current filters.';
      case 'event':
        return 'No events match the current filters.';
      default:
        return 'No intelligence or events yet.';
    }
  });

  protected readonly hasAnyActive = computed(() => {
    return (
      this.query().trim().length > 0 ||
      this.categories().length > 0 ||
      this.since() !== null ||
      this.kind() !== 'all'
    );
  });

  // Re-fetch (and load category options) when the route's spaceId changes.
  private readonly routeEffect = effect(() => {
    const sid = this.spaceId();
    if (sid) {
      void this.load();
      void this.loadCategories(sid);
    }
  });

  ngOnInit(): void {
    this.tenantId.set(this.route.parent?.snapshot.paramMap.get('tenantId') ?? null);
    this.spaceId.set(this.route.parent?.snapshot.paramMap.get('spaceId') ?? null);
    const qp = this.route.snapshot.queryParamMap;
    const statusParam = qp.get('status');
    if (statusParam === 'drafts' || statusParam === 'published') {
      this.status.set(statusParam);
    }
    // motion-strip deep-link: since=7d (or 30d, etc.) pre-sets the Since
    // date-picker to today minus N days so the list lands already filtered.
    const sinceParam = qp.get('since');
    if (sinceParam) {
      const days = parseDayOffset(sinceParam);
      if (days !== null) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        d.setHours(0, 0, 0, 0);
        this.since.set(d);
      }
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

  protected onKindChange(next: KindFilter): void {
    if (next === this.kind()) return;
    this.kind.set(next);
    // category chips only apply to events; clear them when leaving the event view.
    if (next === 'intel') this.categories.set([]);
    this.resetAndLoad();
  }

  protected isCategoryActive(name: string): boolean {
    return this.categories().includes(name);
  }

  protected toggleCategory(name: string): void {
    const current = this.categories();
    this.categories.set(
      current.includes(name) ? current.filter((c) => c !== name) : [...current, name]
    );
    this.resetAndLoad();
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
    this.categories.set([]);
    this.since.set(null);
    this.kind.set('all');
    this.resetAndLoad();
  }

  protected onComposeChosen(target: ComposeTarget): void {
    this.composeDialogOpen.set(false);
    this.composeTarget.set(target);
    this.drawerOpen.set(true);
  }

  protected onDrawerClosed(): void {
    this.drawerOpen.set(false);
  }

  protected async onIntelligencePublished(): Promise<void> {
    this.drawerOpen.set(false);
    this.messageService.add({
      severity: 'success',
      summary: 'Intelligence published.',
      life: 3000,
    });
    await this.load();
  }

  protected async onEventOpen(eventId: string): Promise<void> {
    const detail = await this.eventDetailService.getCatalystDetail(eventId);
    this.eventDetail.set(detail);
    this.eventPanelOpen.set(true);
  }

  protected closeEventPanel(): void {
    this.eventPanelOpen.set(false);
  }

  protected onTrialClick(trialId: string): void {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return;
    this.eventPanelOpen.set(false);
    void this.router.navigate(['/t', tid, 's', sid, 'profiles', 'trials', trialId]);
  }

  private async loadCategories(spaceId: string): Promise<void> {
    this.categoryOptions.set(await this.markerCategory.list(spaceId));
  }

  private async load(): Promise<void> {
    const sid = this.spaceId();
    if (!sid) return;
    this.loading.set(true);
    try {
      if (this.status() === 'drafts') {
        const drafts = await this.intelligence.listDraftsForSpace(sid, DRAFTS_LIMIT);
        const filtered = this.applyDraftFilters(drafts).map(briefRowToFeedItem);
        this.rows.set(filtered);
        this.total.set(filtered.length);
        this.offset.set(0);
      } else {
        const result = await this.feed.list(
          buildFeedQuery({
            spaceId: sid,
            kind: this.kind(),
            categories: this.categories(),
            since: this.since(),
            query: this.query(),
            limit: PAGE_SIZE,
            offset: this.offset(),
          })
        );
        this.rows.set(result.rows);
        this.total.set(result.total);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private applyDraftFilters(rows: IntelligenceFeedRow[]): IntelligenceFeedRow[] {
    const sinceDate = this.since();
    const q = this.query()?.trim().toLowerCase() ?? '';
    return rows.filter((row) => {
      if (sinceDate && new Date(row.updated_at) < sinceDate) return false;
      if (q.length > 0) {
        const headline = row.headline?.toLowerCase() ?? '';
        const summary = row.summary_md?.toLowerCase() ?? '';
        if (!headline.includes(q) && !summary.includes(q)) return false;
      }
      return true;
    });
  }
}
