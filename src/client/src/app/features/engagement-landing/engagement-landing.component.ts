import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, LowerCasePipe, NgClass } from '@angular/common';
import { MessageModule } from 'primeng/message';

import { MarkerIconComponent } from '../../shared/components/svg-icons/marker-icon.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { DashboardService } from '../../core/services/dashboard.service';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';
import { PrimaryIntelligenceService } from '../../core/services/primary-intelligence.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { Space } from '../../core/models/space.model';
import { Tenant } from '../../core/models/tenant.model';
import { Company } from '../../core/models/company.model';
import { Marker } from '../../core/models/marker.model';
import { Trial } from '../../core/models/trial.model';
import { Asset } from '../../core/models/asset.model';
import {
  ENTITY_TYPE_LABEL,
  IntelligenceEntityType,
  IntelligenceFeedRow,
} from '../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../shared/utils/markdown-render';
import { buildEntityRouterLink } from '../../shared/utils/intelligence-router-link';
import {
  EngagementLandingService,
  SpaceLandingStats,
  UpcomingCatalyst,
} from './engagement-landing.service';
import { BriefResult, computeBrief } from './brief-window';
import { RecentMaterialsWidgetComponent } from './recent-materials-widget/recent-materials-widget.component';
import { WhatChangedWidgetComponent } from '../../shared/components/what-changed-widget/what-changed-widget.component';

interface FeedFilter {
  key: 'all' | IntelligenceEntityType;
  label: string;
  count: number;
}

interface MotionCell {
  key: 'p3Readouts' | 'catalysts' | 'newIntel' | 'trialMoves' | 'loe';
  label: string;
  windowLabel: string;
  value: number | null;
  display: string;
  route: unknown[] | null;
  queryParams: Record<string, string> | null;
  warn: boolean;
}

interface InventoryTotals {
  trials: number;
  companies: number;
  assets: number;
}

/**
 * Engagement landing page. Sits at the space root (`/t/:tenantId/s/:spaceId`).
 * Spec: docs/superpowers/specs/2026-05-11-engagement-header-redesign-design.md.
 *
 * Layout:
 *   - Pulse panel: one bordered section with three rows.
 *     - Row 1 (slim identity): slate-50 status band carrying engagement name,
 *       active-since subline, and inline inventory totals.
 *     - Row 2 (hero catalyst): brand-tinted panel with a left date column for
 *       the lead's event date, center title/eyebrow/View link, and a right-side
 *       companion mini-list of the next two upcoming catalysts in the same
 *       window. Auto-hides on quiet days.
 *     - Row 3 (signal strip): single horizontal status line of five motion
 *       metrics with inline window labels. Replaces the prior tile grid.
 *   - Two-column body: intelligence feed (2/3) + side rail (1/3) with the
 *     Next 90 days card stacked on the What changed widget.
 *   - Recent materials: legacy widget kept below the fold.
 */
@Component({
  selector: 'app-engagement-landing',
  standalone: true,
  imports: [
    NgClass,
    DatePipe,
    LowerCasePipe,
    RouterLink,
    MessageModule,
    MarkerIconComponent,
    SkeletonComponent,
    RecentMaterialsWidgetComponent,
    WhatChangedWidgetComponent,
  ],
  templateUrl: './engagement-landing.component.html',
  host: { class: 'block h-full overflow-y-auto bg-white' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EngagementLandingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engagementService = inject(EngagementLandingService);
  private readonly dashboardService = inject(DashboardService);
  private readonly spaceService = inject(SpaceService);
  private readonly tenantService = inject(TenantService);
  private readonly intelligenceService = inject(PrimaryIntelligenceService);
  private readonly brand = inject(BrandContextService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly space = signal<Space | null>(null);
  readonly tenant = signal<Tenant | null>(null);
  readonly stats = signal<SpaceLandingStats | null>(null);
  readonly statsLoading = signal(true);
  readonly upcoming = signal<UpcomingCatalyst[]>([]);
  readonly upcomingLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly latestIntelligence = signal<IntelligenceFeedRow[]>([]);
  readonly latestLoading = signal(true);
  readonly feedFilter = signal<'all' | IntelligenceEntityType>('all');
  protected readonly skeletonRows = [0, 1, 2, 3, 4];

  readonly hasFeedItems = computed(() => this.latestIntelligence().length > 0);
  readonly spaceName = computed(() => this.space()?.name ?? '');
  readonly tenantName = computed(() => this.tenant()?.name ?? '');

  readonly intelligenceBrowseRoute = computed(() => {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return '';
    return `/t/${tid}/s/${sid}/intelligence`;
  });

  /**
   * Route to the engagement activity feed. Used by the intelligence empty
   * state so a client analyst can see in-progress drafts surfaced by the
   * agency before any read has been published.
   */
  readonly activityRoute = computed<string[] | null>(() => {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return null;
    return ['/t', tid, 's', sid, 'activity'];
  });

  /** "Stout lead" when the tenant has an agency, otherwise "agency lead". */
  readonly agencyLeadLabel = computed(() => {
    const name = this.brand.agency()?.name;
    return name ? `${name} lead` : 'agency lead';
  });

  readonly catalystsRoute = computed(() => {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return '';
    return `/t/${tid}/s/${sid}/catalysts`;
  });

  readonly statsRoutes = computed(() => {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return null;
    const base = `/t/${tid}/s/${sid}`;
    return {
      activeTrials: `${base}/manage/trials`,
      companies: `${base}/manage/companies`,
      assets: `${base}/manage/assets`,
      catalysts: `${base}/catalysts`,
      intelligence: `${base}/intelligence`,
    };
  });

  readonly motionStats = computed<MotionCell[]>(() => {
    const s = this.stats();
    const tid = this.tenantId();
    const sid = this.spaceId();
    const hasRoute = !!(tid && sid);
    const v = (n: number | undefined | null): number | null => (n == null ? null : n);
    const cells: MotionCell[] = [
      {
        key: 'p3Readouts',
        label: 'P3 readouts',
        windowLabel: 'next 90d',
        value: v(s?.p3_readouts_90d),
        display: s?.p3_readouts_90d == null ? '' : String(s.p3_readouts_90d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { phase: 'P3', within: '90d' } : null,
        warn: (s?.p3_readouts_90d ?? 0) > 0,
      },
      {
        key: 'catalysts',
        label: 'Catalysts',
        windowLabel: 'next 90d',
        value: v(s?.catalysts_90d),
        display: s?.catalysts_90d == null ? '' : String(s.catalysts_90d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { within: '90d' } : null,
        warn: (s?.catalysts_90d ?? 0) > 0,
      },
      {
        key: 'newIntel',
        label: 'New intel',
        windowLabel: 'last 7d',
        value: v(s?.new_intel_7d),
        display: s?.new_intel_7d == null ? '' : s.new_intel_7d > 0 ? `+${s.new_intel_7d}` : '0',
        route: hasRoute ? ['/t', tid, 's', sid, 'intelligence'] : null,
        queryParams: hasRoute ? { since: '7d' } : null,
        warn: false,
      },
      {
        key: 'trialMoves',
        label: 'Trial moves',
        windowLabel: 'last 30d',
        value: v(s?.trial_moves_30d),
        display: s?.trial_moves_30d == null ? '' : String(s.trial_moves_30d),
        route: hasRoute ? ['/t', tid, 's', sid, 'activity'] : null,
        queryParams: hasRoute
          ? { eventTypes: 'phase_transitioned,status_changed', within: '30d' }
          : null,
        warn: false,
      },
      {
        key: 'loe',
        label: 'Loss of excl.',
        windowLabel: 'next 365d',
        value: v(s?.loe_365d),
        display: s?.loe_365d == null ? '' : String(s.loe_365d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { markerKind: 'loe', within: '365d' } : null,
        warn: (s?.loe_365d ?? 0) > 0,
      },
    ];
    return cells;
  });

  readonly engagementName = computed(() => this.spaceName().toUpperCase());

  readonly activeSince = computed(() => {
    const s = this.space();
    if (!s?.created_at) return '';
    const d = new Date(s.created_at);
    const year = d.getUTCFullYear();
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Active since ${year}-Q${quarter}`;
  });

  readonly inventoryTotals = computed<InventoryTotals | null>(() => {
    const s = this.stats();
    if (!s) return null;
    return { trials: s.active_trials, companies: s.companies, assets: s.assets };
  });

  readonly briefVisible = computed(() => this.brief() !== null);

  readonly brief = computed<BriefResult | null>(() => {
    if (this.statsLoading() || this.upcomingLoading()) return null;
    const list = this.upcoming().map((c) => ({
      marker_id: c.marker_id,
      event_date: c.event_date,
      title: c.title,
      company_name: c.company_name,
    }));
    return computeBrief(list, new Date());
  });

  readonly briefDateParts = computed(() => {
    const b = this.brief();
    if (!b) return null;
    const d = new Date(b.lead.event_date + 'T00:00:00Z');
    return {
      weekday: SHORT_DAYS[d.getUTCDay()].toUpperCase(),
      day: String(d.getUTCDate()),
      month: MONTH_LABELS[d.getUTCMonth()],
    };
  });

  readonly briefCompanions = computed<BriefCompanion[]>(() => {
    const b = this.brief();
    if (!b || b.additional <= 0) return [];
    const cap = b.window === 'THIS WEEK' ? 7 : b.window === 'THIS MONTH' ? 30 : 90;
    return this.upcoming()
      .filter((c) => c.marker_id !== b.lead.marker_id)
      .filter((c) => daysFromTodayUtc(c.event_date) <= cap)
      .slice(0, 2)
      .map((c) => {
        const d = new Date(c.event_date + 'T00:00:00Z');
        return {
          marker_id: c.marker_id,
          weekday: SHORT_DAYS[d.getUTCDay()].toUpperCase(),
          day: String(d.getUTCDate()),
          title: c.title,
        };
      });
  });

  readonly nextNinetyDayItems = computed<CatalystDay[]>(() => {
    return this.upcoming().map((c) => {
      const d = new Date(c.event_date + 'T00:00:00');
      return {
        marker_id: c.marker_id,
        event_date: c.event_date,
        day: String(d.getDate()).padStart(2, '0'),
        weekday: SHORT_DAYS[d.getDay()].toUpperCase(),
        monthLabel: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`,
        isToday: c.event_date === todayIso(),
        title: c.title || c.category_name || 'Catalyst',
        who: [c.company_name?.toUpperCase(), c.product_name, c.is_projected ? 'PROJECTED' : null]
          .filter((p): p is string => !!p)
          .join(' · '),
        color: c.marker_type_color || '#16a34a',
        shape: c.marker_type_shape,
        fillStyle: c.is_projected ? ('outline' as const) : c.marker_type_fill_style,
        innerMark: c.marker_type_inner_mark,
        isNle: c.no_longer_expected,
      };
    });
  });

  readonly monthGroupedCatalysts = computed<MonthGroup[]>(() => {
    const items = this.nextNinetyDayItems().slice(0, 5);
    const groups: MonthGroup[] = [];
    for (const item of items) {
      const last = groups[groups.length - 1];
      if (last && last.monthLabel === item.monthLabel) {
        last.items.push(item);
      } else {
        groups.push({ monthLabel: item.monthLabel, items: [item] });
      }
    }
    return groups;
  });

  readonly feedFilters = computed<FeedFilter[]>(() => {
    const rows = this.latestIntelligence();
    const counts = new Map<IntelligenceEntityType, number>();
    for (const r of rows) {
      counts.set(r.entity_type, (counts.get(r.entity_type) ?? 0) + 1);
    }
    const order: IntelligenceEntityType[] = ['trial', 'company', 'product', 'marker', 'space'];
    const out: FeedFilter[] = [{ key: 'all', label: 'All', count: rows.length }];
    for (const type of order) {
      const n = counts.get(type) ?? 0;
      if (n > 0) {
        out.push({ key: type, label: ENTITY_TYPE_LABEL[type] ?? type, count: n });
      }
    }
    return out;
  });

  readonly visibleFeed = computed<IntelligenceFeedRow[]>(() => {
    const f = this.feedFilter();
    const rows = this.latestIntelligence();
    return f === 'all' ? rows : rows.filter((r) => r.entity_type === f);
  });

  readonly featuredPost = computed(() => this.visibleFeed()[0] ?? null);
  readonly restPosts = computed(() => this.visibleFeed().slice(1, 4));

  readonly feedHeaderTag = computed(() => {
    const total = this.latestIntelligence().length;
    const week = recentCount(this.latestIntelligence(), 7);
    return { total, week };
  });

  ngOnInit(): void {
    this.extractRouteParams();
    void this.loadAll();
  }

  setFeedFilter(key: FeedFilter['key']): void {
    this.feedFilter.set(key);
  }

  onUpcomingRowClick(markerId: string): void {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return;
    void this.router.navigate(['/t', tid, 's', sid, 'catalysts'], {
      queryParams: { markerId },
    });
  }

  onCalendarClick(markerId: string): void {
    this.onUpcomingRowClick(markerId);
  }

  postRouterLink(row: IntelligenceFeedRow): unknown[] {
    return (
      buildEntityRouterLink(this.tenantId(), this.spaceId(), row.entity_type, row.entity_id) ?? []
    );
  }

  postKindLabel(row: IntelligenceFeedRow): string {
    return ENTITY_TYPE_LABEL[row.entity_type] ?? row.entity_type;
  }

  kindTextClass(row: IntelligenceFeedRow): string {
    switch (row.entity_type) {
      case 'trial':
        return 'text-sky-800';
      case 'company':
        return 'text-slate-600';
      case 'product':
        return 'text-brand-700';
      case 'marker':
        return 'text-orange-800';
      case 'space':
        return 'text-slate-600';
      default:
        return 'text-slate-700';
    }
  }

  postExcerpt(row: IntelligenceFeedRow): string {
    return renderMarkdownInline(row.summary_md ?? '');
  }

  trackPost = (_: number, row: IntelligenceFeedRow): string => row.id;
  trackStat = (_: number, s: MotionCell): string => s.key;
  trackFilter = (_: number, f: FeedFilter): string => f.key;
  trackDay = (_: number, d: CatalystDay): string => d.marker_id;
  trackMonth = (_: number, g: MonthGroup): string => g.monthLabel;

  private extractRouteParams(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }
  }

  private async loadAll(): Promise<void> {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!sid || !tid) return;

    this.statsLoading.set(true);
    this.upcomingLoading.set(true);
    this.latestLoading.set(true);
    this.loadError.set(null);

    const [spaceRes, tenantRes, statsRes, dashRes, latestRes] = await Promise.allSettled([
      this.spaceService.getSpace(sid),
      this.tenantService.getTenant(tid),
      this.engagementService.getStats(sid),
      this.dashboardService.getDashboardData(sid, emptyFilters()),
      this.intelligenceService.list({ spaceId: sid, limit: 8 }),
    ]);

    if (spaceRes.status === 'fulfilled') this.space.set(spaceRes.value);
    if (tenantRes.status === 'fulfilled') this.tenant.set(tenantRes.value);
    if (statsRes.status === 'fulfilled') {
      this.stats.set(statsRes.value);
    } else {
      this.loadError.set(formatError(statsRes.reason, 'Failed to load engagement stats.'));
    }
    if (dashRes.status === 'fulfilled') {
      this.upcoming.set(extractUpcoming(dashRes.value.companies, 90));
    }
    if (latestRes.status === 'fulfilled') this.latestIntelligence.set(latestRes.value.rows);

    this.statsLoading.set(false);
    this.upcomingLoading.set(false);
    this.latestLoading.set(false);
  }
}

interface BriefCompanion {
  marker_id: string;
  weekday: string;
  day: string;
  title: string;
}

interface CatalystDay {
  marker_id: string;
  event_date: string;
  day: string;
  weekday: string;
  monthLabel: string;
  isToday: boolean;
  title: string;
  who: string;
  color: string;
  shape: import('../../core/models/marker.model').MarkerShape;
  fillStyle: import('../../core/models/marker.model').FillStyle;
  innerMark: import('../../core/models/marker.model').InnerMark;
  isNle: boolean;
}

interface MonthGroup {
  monthLabel: string;
  items: CatalystDay[];
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

function emptyFilters() {
  return {
    companyIds: null,
    assetIds: null,
    therapeuticAreaIds: null,
    startYear: null,
    endYear: null,
    recruitmentStatuses: null,
    studyTypes: null,
    phases: null,
    mechanismOfActionIds: null,
    routeOfAdministrationIds: null,
  };
}

function daysFromTodayUtc(eventDateIso: string): number {
  const event = new Date(eventDateIso + 'T00:00:00Z').getTime();
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((event - today) / 86_400_000);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function extractUpcoming(companies: Company[], windowDays: number): UpcomingCatalyst[] {
  const today = todayIso();
  const horizon = addDaysIso(windowDays);
  const out: UpcomingCatalyst[] = [];

  for (const company of companies) {
    for (const asset of company.products ?? ([] as Asset[])) {
      for (const trial of asset.trials ?? ([] as Trial[])) {
        for (const marker of trial.markers ?? ([] as Marker[])) {
          if (!marker.event_date) continue;
          if (marker.event_date < today || marker.event_date > horizon) continue;
          const mt = marker.marker_types;
          out.push({
            marker_id: marker.id,
            title: marker.title ?? mt?.name ?? 'Catalyst',
            event_date: marker.event_date,
            is_projected: marker.is_projected,
            no_longer_expected: marker.no_longer_expected,
            category_name: mt?.marker_categories?.name ?? '',
            marker_type_color: mt?.color ?? '',
            marker_type_shape: mt?.shape ?? 'circle',
            marker_type_fill_style: mt?.fill_style ?? 'filled',
            marker_type_inner_mark: mt?.inner_mark ?? 'none',
            company_name: company.name,
            product_name: asset.name,
            trial_name: trial.name ?? null,
          });
        }
      }
    }
  }

  out.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.title.localeCompare(b.title));
  return out;
}

function recentCount(rows: IntelligenceFeedRow[], days: number): number {
  const cutoff = Date.now() - days * 86_400_000;
  return rows.filter((r) => new Date(r.updated_at).getTime() >= cutoff).length;
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}
