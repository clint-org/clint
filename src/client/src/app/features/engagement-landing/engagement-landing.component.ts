import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';

import { DashboardService } from '../../core/services/dashboard.service';
import { SpaceService } from '../../core/services/space.service';
import { PrimaryIntelligenceService } from '../../core/services/primary-intelligence.service';
import { Space } from '../../core/models/space.model';
import { Company } from '../../core/models/company.model';
import { Marker } from '../../core/models/marker.model';
import { Trial } from '../../core/models/trial.model';
import { Product } from '../../core/models/product.model';
import { IntelligenceFeedRow } from '../../core/models/primary-intelligence.model';
import {
  EngagementLandingService,
  SpaceLandingStats,
  UpcomingCatalyst,
} from './engagement-landing.service';
import { EngagementContextStripComponent } from './context-strip/context-strip.component';
import { DraftsWidgetComponent } from './drafts-widget/drafts-widget.component';
import { UpcomingCatalystsWidgetComponent } from './upcoming-catalysts-widget/upcoming-catalysts-widget.component';
import { RecentMaterialsWidgetComponent } from './recent-materials-widget/recent-materials-widget.component';
import { IntelligenceFeedComponent } from '../../shared/components/intelligence-feed/intelligence-feed.component';

/**
 * Engagement landing page (docs/specs/engagement-landing/spec.md).
 *
 * Sits at the space root (`/t/:tenantId/s/:spaceId`). Hosts:
 *   - Context strip: title, active-since subline, five header stats.
 *   - Latest from Stout: most recent published primary intelligence rows.
 *   - Recent materials: most recent registered materials in the engagement.
 *   - Your drafts (agency only): up to 3 in-progress drafts from anyone in
 *     the agency on this engagement. Hidden for non-agency viewers.
 *   - Next 14 days catalysts: derived client-side from `get_dashboard_data`,
 *     reusing the existing markers feed.
 */
@Component({
  selector: 'app-engagement-landing',
  standalone: true,
  imports: [
    RouterLink,
    ProgressSpinner,
    MessageModule,
    EngagementContextStripComponent,
    DraftsWidgetComponent,
    UpcomingCatalystsWidgetComponent,
    RecentMaterialsWidgetComponent,
    IntelligenceFeedComponent,
  ],
  templateUrl: './engagement-landing.component.html',
  styleUrls: ['./engagement-landing.component.css'],
})
export class EngagementLandingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engagementService = inject(EngagementLandingService);
  private readonly dashboardService = inject(DashboardService);
  private readonly spaceService = inject(SpaceService);
  private readonly intelligenceService = inject(PrimaryIntelligenceService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly space = signal<Space | null>(null);
  readonly stats = signal<SpaceLandingStats | null>(null);
  readonly statsLoading = signal(true);
  readonly upcoming = signal<UpcomingCatalyst[]>([]);
  readonly upcomingLoading = signal(true);
  readonly isAgency = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly latestIntelligence = signal<IntelligenceFeedRow[]>([]);
  readonly latestLoading = signal(true);
  readonly drafts = signal<IntelligenceFeedRow[]>([]);

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

  readonly activeSinceLabel = computed(() => {
    const s = this.space();
    if (!s?.created_at) return '';
    const d = new Date(s.created_at);
    const year = d.getUTCFullYear();
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
    return `${year}-Q${quarter}`;
  });

  readonly spaceName = computed(() => this.space()?.name ?? '');

  ngOnInit(): void {
    this.extractRouteParams();
    void this.loadAll();
  }

  onUpcomingRowClick(markerId: string): void {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return;
    void this.router.navigate(['/t', tid, 's', sid, 'catalysts'], {
      queryParams: { markerId },
    });
  }

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

    const [spaceRes, statsRes, dashRes, agencyRes, latestRes, draftsRes] =
      await Promise.allSettled([
        this.spaceService.getSpace(sid),
        this.engagementService.getStats(sid),
        this.dashboardService.getDashboardData(sid, emptyFilters()),
        this.engagementService.isAgencyMemberOfTenant(tid),
        this.intelligenceService.list({ spaceId: sid, limit: 5 }),
        this.intelligenceService.listDraftsForSpace(sid, 3),
      ]);

    if (spaceRes.status === 'fulfilled') {
      this.space.set(spaceRes.value);
    }
    if (statsRes.status === 'fulfilled') {
      this.stats.set(statsRes.value);
    } else {
      this.loadError.set(formatError(statsRes.reason, 'Failed to load engagement stats.'));
    }
    if (dashRes.status === 'fulfilled') {
      this.upcoming.set(extractUpcoming(dashRes.value.companies, 14));
    }
    if (agencyRes.status === 'fulfilled') {
      this.isAgency.set(agencyRes.value);
    }
    if (latestRes.status === 'fulfilled') {
      this.latestIntelligence.set(latestRes.value.rows);
    }
    if (draftsRes.status === 'fulfilled') {
      this.drafts.set(draftsRes.value);
    }

    this.statsLoading.set(false);
    this.upcomingLoading.set(false);
    this.latestLoading.set(false);
  }
}

function emptyFilters() {
  return {
    companyIds: null,
    productIds: null,
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

/**
 * Walk company > product > trial > marker and pull markers within the
 * upcoming `windowDays` days. Sorted ascending by event_date.
 */
function extractUpcoming(companies: Company[], windowDays: number): UpcomingCatalyst[] {
  const today = todayIso();
  const horizon = addDaysIso(windowDays);
  const out: UpcomingCatalyst[] = [];

  for (const company of companies) {
    for (const product of company.products ?? ([] as Product[])) {
      for (const trial of product.trials ?? ([] as Trial[])) {
        for (const marker of trial.markers ?? ([] as Marker[])) {
          if (!marker.event_date) continue;
          if (marker.event_date < today || marker.event_date > horizon) continue;
          const mt = marker.marker_types;
          out.push({
            marker_id: marker.id,
            title: marker.title ?? mt?.name ?? 'Catalyst',
            event_date: marker.event_date,
            is_projected: marker.is_projected,
            category_name: mt?.marker_categories?.name ?? '',
            marker_type_color: mt?.color ?? '',
            company_name: company.name,
            product_name: product.name,
            trial_name: trial.name ?? null,
          });
        }
      }
    }
  }

  out.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.title.localeCompare(b.title));
  return out;
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}
