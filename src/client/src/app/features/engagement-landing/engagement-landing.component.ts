import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, NgClass } from '@angular/common';
import { MessageModule } from 'primeng/message';

import { MarkerIconComponent } from '../../shared/components/svg-icons/marker-icon.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { DashboardService } from '../../core/services/dashboard.service';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';
import { PrimaryIntelligenceService } from '../../core/services/primary-intelligence.service';
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
import { RecentMaterialsWidgetComponent } from './recent-materials-widget/recent-materials-widget.component';
import { WhatChangedWidgetComponent } from '../../shared/components/what-changed-widget/what-changed-widget.component';

interface Stat {
  key: 'activeTrials' | 'companies' | 'assets' | 'catalysts' | 'intelligence';
  label: string;
  value: number | null;
  route: string | null;
  warn: boolean;
}

interface FeedFilter {
  key: 'all' | IntelligenceEntityType;
  label: string;
  count: number;
}

/**
 * Engagement landing page. Sits at the space root (`/t/:tenantId/s/:spaceId`).
 * Spec: docs/superpowers/specs/2026-05-10-home-redesign-design.md.
 *
 * Layout:
 *   - Pulse header: tracked eyebrow, h1, since-line, integrated 5-stat strip.
 *   - Today brief: optional one-line teal-accented catalysts-this-week rollup.
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

  readonly pulseStats = computed<Stat[]>(() => {
    const s = this.stats();
    const r = this.statsRoutes();
    return [
      {
        key: 'activeTrials',
        label: 'Active trials',
        value: s?.active_trials ?? null,
        route: r?.activeTrials ?? null,
        warn: false,
      },
      {
        key: 'companies',
        label: 'Companies',
        value: s?.companies ?? null,
        route: r?.companies ?? null,
        warn: false,
      },
      {
        key: 'assets',
        label: 'Assets',
        value: s?.assets ?? null,
        route: r?.assets ?? null,
        warn: false,
      },
      {
        key: 'catalysts',
        label: 'Catalysts < 90d',
        value: s?.catalysts_90d ?? null,
        route: r?.catalysts ?? null,
        warn: true,
      },
      {
        key: 'intelligence',
        label: 'Intelligence',
        value: s?.intelligence_total ?? null,
        route: r?.intelligence ?? null,
        warn: false,
      },
    ];
  });

  readonly eyebrowParts = computed(() => {
    const t = this.tenantName();
    const s = this.spaceName();
    return [t, s, 'ENGAGEMENT'].filter((p): p is string => !!p).map((p) => p.toUpperCase());
  });

  readonly activeSinceLabel = computed(() => {
    const s = this.space();
    if (!s?.created_at) return '';
    const d = new Date(s.created_at);
    const year = d.getUTCFullYear();
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Active since ${year}-Q${quarter}`;
  });

  /** Catalysts within the next 7 days (subset of upcoming()). */
  readonly catalystsThisWeek = computed(() => {
    const horizon = addDaysIso(7);
    const today = todayIso();
    return this.upcoming().filter((c) => c.event_date >= today && c.event_date <= horizon);
  });

  readonly briefVisible = computed(
    () => !this.statsLoading() && this.catalystsThisWeek().length > 0
  );

  readonly briefHtml = computed(() => {
    const week = this.catalystsThisWeek();
    if (week.length === 0) return '';
    const lead = week[0];
    const detail = lead
      ? ` (${escapeHtml(lead.title)}${lead.company_name ? ' · ' + escapeHtml(lead.company_name.toUpperCase()) : ''})`
      : '';
    return `<b>${week.length} catalyst${week.length === 1 ? '' : 's'} this week</b>${detail}`;
  });

  readonly todayLabel = computed(() => {
    return new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
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
    const items = this.nextNinetyDayItems();
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
  readonly restPosts = computed(() => this.visibleFeed().slice(1));

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

  kindBgClass(row: IntelligenceFeedRow): string {
    switch (row.entity_type) {
      case 'trial':
        return 'bg-sky-900';
      case 'company':
        return 'bg-slate-700';
      case 'product':
        return 'bg-brand-700';
      case 'marker':
        return 'bg-orange-900';
      case 'space':
        return 'bg-slate-600';
      default:
        return 'bg-slate-900';
    }
  }

  postExcerpt(row: IntelligenceFeedRow): string {
    return renderMarkdownInline(row.thesis_md ?? '');
  }

  trackPost = (_: number, row: IntelligenceFeedRow): string => row.id;
  trackStat = (_: number, s: Stat): string => s.key;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}
