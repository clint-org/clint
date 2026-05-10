import { computed, effect, inject, Injectable, signal } from '@angular/core';

import { Company } from '../../core/models/company.model';
import { Product } from '../../core/models/product.model';
import { Catalyst, CatalystDetail, FlatCatalyst } from '../../core/models/catalyst.model';
import { DashboardData } from '../../core/models/dashboard.model';
import { ZoomLevel } from '../../core/models/dashboard.model';
import {
  CountUnit,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  PositioningGrouping,
  SpokeMode,
} from '../../core/models/landscape.model';
import { DashboardService } from '../../core/services/dashboard.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { groupCatalystsByTimePeriod, flattenGroupedCatalysts } from '../catalysts/group-catalysts';

interface PersistedLandscapeState {
  filters: LandscapeFilters;
  zoomLevel: ZoomLevel;
  spokeMode: SpokeMode;
  positioningGrouping: PositioningGrouping;
  countUnit: CountUnit;
}

const STORAGE_PREFIX = 'landscape-state:';

/**
 * Shared state for the unified Landscape module.
 * Provided by LandscapeShellComponent so all child views share one instance.
 *
 * Owns:
 * - Raw dashboard data (fetched once, unfiltered)
 * - Filter state (applied client-side)
 * - Filtered views (companies for timeline, flat catalysts for catalysts tab)
 * - Shared detail panel state (selected marker, detail, loading)
 * - View-specific settings (zoom, spoke mode, positioning grouping)
 *
 * State is persisted to sessionStorage so it survives page refreshes.
 */
@Injectable({ providedIn: 'any' })
export class LandscapeStateService {
  private readonly dashboardService = inject(DashboardService);
  private readonly supabase = inject(SupabaseService);
  private storageKey = '';
  private spaceId = '';

  /** Read-only signal exposing the bound space id (empty string before init). */
  readonly spaceIdSig = signal('');

  // ─── Raw data ────────────────────────────────────────────────────────
  readonly rawData = signal<DashboardData | null>(null);
  readonly dataLoading = signal(false);
  readonly dataError = signal<string | null>(null);

  // ─── Filters ─────────────────────────────────────────────────────────
  readonly filters = signal<LandscapeFilters>({ ...EMPTY_LANDSCAPE_FILTERS });

  // ─── View-specific settings ──────────────────────────────────────────
  readonly zoomLevel = signal<ZoomLevel>('yearly');
  readonly spokeMode = signal<SpokeMode>('grouped');
  readonly positioningGrouping = signal<PositioningGrouping>('moa+therapeutic-area');
  readonly countUnit = signal<CountUnit>('products');

  // ─── Shared detail panel ─────────────────────────────────────────────
  readonly selectedMarkerId = signal<string | null>(null);
  readonly selectedDetail = signal<CatalystDetail | null>(null);
  readonly detailLoading = signal(false);

  // ─── Filtered views (computed) ───────────────────────────────────────

  /** Filtered company hierarchy for the timeline view. */
  readonly filteredCompanies = computed<Company[]>(() => {
    const raw = this.rawData();
    if (!raw) return [];
    return filterDashboardData(raw.companies, this.filters());
  });

  /** Flat catalyst list (future markers) for the catalysts tab. */
  readonly filteredCatalysts = computed<FlatCatalyst[]>(() => {
    const companies = this.filteredCompanies();
    const today = todayStr();
    const catalysts = flattenToCatalysts(companies, today);
    const groups = groupCatalystsByTimePeriod(catalysts);
    return flattenGroupedCatalysts(groups);
  });

  // ─── Persistence ─────────────────────────────────────────────────────

  private readonly persistEffect = effect(() => {
    const state: PersistedLandscapeState = {
      filters: this.filters(),
      zoomLevel: this.zoomLevel(),
      spokeMode: this.spokeMode(),
      positioningGrouping: this.positioningGrouping(),
      countUnit: this.countUnit(),
    };
    if (!this.storageKey) return;
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Storage full or unavailable -- silently ignore.
    }
  });

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Bind this service instance to a space, restore persisted state,
   * and fetch the full unfiltered dataset.
   */
  async init(spaceId: string): Promise<void> {
    this.spaceId = spaceId;
    this.spaceIdSig.set(spaceId);
    this.storageKey = STORAGE_PREFIX + spaceId;
    this.restorePersistedState();
    await this.loadData();
  }

  /** Reload the dataset (e.g. after data mutation). */
  async reload(): Promise<void> {
    await this.loadData();
  }

  /** Select a marker and fetch its detail. */
  async selectMarker(markerId: string): Promise<void> {
    if (this.selectedMarkerId() === markerId) {
      this.clearSelection();
      return;
    }
    this.selectedMarkerId.set(markerId);
    this.selectedDetail.set(null);
    this.detailLoading.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('get_catalyst_detail', {
        p_marker_id: markerId,
      });
      if (error) throw error;
      if (this.selectedMarkerId() === markerId) {
        this.selectedDetail.set(data as CatalystDetail);
      }
    } catch {
      // On error, close the panel
      this.clearSelection();
    } finally {
      this.detailLoading.set(false);
    }
  }

  /** Close the detail panel. */
  clearSelection(): void {
    this.selectedMarkerId.set(null);
    this.selectedDetail.set(null);
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    if (!this.spaceId) return;
    this.dataLoading.set(true);
    this.dataError.set(null);
    try {
      const nullFilters = {
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
      const data = await this.dashboardService.getDashboardData(this.spaceId, nullFilters);
      this.rawData.set(data);
    } catch (err) {
      this.dataError.set(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      this.dataLoading.set(false);
    }
  }

  private restorePersistedState(): void {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (!raw) return;
      const saved: PersistedLandscapeState = JSON.parse(raw);
      if (saved.filters) this.filters.set(saved.filters);
      if (saved.zoomLevel) this.zoomLevel.set(saved.zoomLevel);
      if (saved.spokeMode) this.spokeMode.set(saved.spokeMode);
      if (saved.positioningGrouping) this.positioningGrouping.set(saved.positioningGrouping);
      if (saved.countUnit) this.countUnit.set(saved.countUnit);
    } catch {
      // Corrupt data -- ignore and start fresh.
    }
  }
}

// ─── Pure filtering functions ────────────────────────────────────────────

function filterDashboardData(companies: Company[], filters: LandscapeFilters): Company[] {
  let result = companies;

  if (filters.companyIds.length > 0) {
    result = result.filter((c) => filters.companyIds.includes(c.id));
  }

  return result
    .map((c) => {
      let products = c.products ?? [];

      if (filters.productIds.length > 0) {
        products = products.filter((p) => filters.productIds.includes(p.id));
      }
      if (filters.mechanismOfActionIds.length > 0) {
        products = products.filter((p) =>
          (p.mechanisms_of_action ?? []).some((m) => filters.mechanismOfActionIds.includes(m.id))
        );
      }
      if (filters.routeOfAdministrationIds.length > 0) {
        products = products.filter((p) =>
          (p.routes_of_administration ?? []).some((r) =>
            filters.routeOfAdministrationIds.includes(r.id)
          )
        );
      }

      products = products
        .map((p) => {
          let trials = p.trials ?? [];

          if (filters.therapeuticAreaIds.length > 0) {
            trials = trials.filter(
              (t) =>
                t.therapeutic_area_id && filters.therapeuticAreaIds.includes(t.therapeutic_area_id)
            );
          }
          if (filters.phases.length > 0) {
            trials = trials.filter(
              (t) => t.phase_type && (filters.phases as string[]).includes(t.phase_type)
            );
          }
          if (filters.recruitmentStatuses.length > 0) {
            trials = trials.filter(
              (t) =>
                t.recruitment_status && filters.recruitmentStatuses.includes(t.recruitment_status)
            );
          }
          if (filters.studyTypes.length > 0) {
            trials = trials.filter(
              (t) => t.study_type && filters.studyTypes.includes(t.study_type)
            );
          }

          // Filter markers by category if set
          if (filters.markerCategoryIds.length > 0) {
            trials = trials.map((t) => ({
              ...t,
              markers: (t.markers ?? []).filter((m) => {
                const catId = m.marker_types?.category_id ?? m.marker_types?.marker_categories?.id;
                return catId && filters.markerCategoryIds.includes(catId);
              }),
            }));
          }

          if (trials.length === 0) return null;
          return { ...p, trials } as Product;
        })
        .filter((p): p is Product => p !== null);

      if (products.length === 0) return null;
      return { ...c, products } as Company;
    })
    .filter((c): c is Company => c !== null);
}

/**
 * Flatten the company > product > trial > marker hierarchy into a flat
 * Catalyst[] array, keeping only markers with event_date >= today.
 */
function flattenToCatalysts(companies: Company[], today: string): Catalyst[] {
  const catalysts: Catalyst[] = [];

  for (const company of companies) {
    for (const product of company.products ?? []) {
      for (const trial of product.trials ?? []) {
        for (const marker of trial.markers ?? []) {
          if (marker.event_date < today) continue;

          const mt = marker.marker_types;
          catalysts.push({
            marker_id: marker.id,
            title: marker.title ?? '',
            event_date: marker.event_date,
            end_date: marker.end_date ?? null,
            category_name: mt?.marker_categories?.name ?? '',
            category_id: mt?.category_id ?? '',
            marker_type_name: mt?.name ?? '',
            marker_type_icon: mt?.icon ?? null,
            marker_type_color: mt?.color ?? '',
            marker_type_shape: mt?.shape ?? 'circle',
            is_projected: marker.is_projected,
            company_name: company.name,
            company_id: company.id,
            product_name: product.name,
            product_id: product.id,
            trial_name: trial.name,
            trial_id: trial.id,
            trial_phase: trial.phase_type ?? trial.phase ?? null,
            description: marker.description ?? null,
            source_url: marker.source_url ?? null,
            trial_recent_changes_count: trial.recent_changes_count ?? 0,
            trial_most_recent_change_type: trial.most_recent_change_type ?? null,
          });
        }
      }
    }
  }

  catalysts.sort(
    (a, b) => a.event_date.localeCompare(b.event_date) || a.title.localeCompare(b.title)
  );
  return catalysts;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
