import { computed, effect, inject, Injectable, signal } from '@angular/core';

import { Company } from '../../core/models/company.model';
import { Asset } from '../../core/models/asset.model';
import { Catalyst, CatalystDetail, FlatCatalyst } from '../../core/models/catalyst.model';
import { DashboardData } from '../../core/models/dashboard.model';
import { ZoomLevel } from '../../core/models/dashboard.model';
import {
  CountUnit,
  HeatmapGrouping,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  SpokeGrouping,
  SpokeMode,
} from '../../core/models/landscape.model';
import { CatalystService } from '../../core/services/catalyst.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { SpaceSettingsService } from '../../core/services/space-settings.service';
import { groupCatalystsByTimePeriod, flattenGroupedCatalysts } from '../catalysts/group-catalysts';

interface PersistedLandscapeState {
  filters: LandscapeFilters;
  zoomLevel: ZoomLevel;
  spokeMode: SpokeMode;
  spokeGrouping: SpokeGrouping;
  heatmapGrouping: HeatmapGrouping;
  countUnit: CountUnit;
  showMoaColumn: boolean;
  showRoaColumn: boolean;
  showNotesColumn: boolean;
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
 * - View-specific settings (zoom, spoke mode, heatmap grouping)
 *
 * State is persisted to sessionStorage so it survives page refreshes.
 */
@Injectable({ providedIn: 'any' })
export class LandscapeStateService {
  private readonly dashboardService = inject(DashboardService);
  private readonly catalyst = inject(CatalystService);
  private readonly spaceSettings = inject(SpaceSettingsService);
  private storageKey = '';
  private spaceId = '';
  private disablePersistence = false;

  /** Read-only signal exposing the bound space id (empty string before init). */
  readonly spaceIdSig = signal('');

  /**
   * Whether this space tracks the preclinical phase (default false). Drives
   * which phases the filter bar and ring legends show. Records are already
   * excluded server-side; this only narrows the UI controls.
   */
  readonly showPreclinical = signal(false);

  // ─── Raw data ────────────────────────────────────────────────────────
  readonly rawData = signal<DashboardData | null>(null);
  readonly dataLoading = signal(false);
  readonly dataError = signal<string | null>(null);

  // ─── Filters ─────────────────────────────────────────────────────────
  readonly filters = signal<LandscapeFilters>({ ...EMPTY_LANDSCAPE_FILTERS });

  // ─── View-specific settings ──────────────────────────────────────────
  readonly zoomLevel = signal<ZoomLevel>('yearly');
  /** @deprecated Use spokeGrouping instead. Kept during migration. */
  readonly spokeMode = signal<SpokeMode>('grouped');
  readonly spokeGrouping = signal<SpokeGrouping>('company');
  readonly heatmapGrouping = signal<HeatmapGrouping>('moa+indication');
  readonly countUnit = signal<CountUnit>('assets');

  // ─── Column visibility (timeline grid) ──────────────────────────────
  readonly showMoaColumn = signal(true);
  readonly showRoaColumn = signal(true);
  readonly showNotesColumn = signal(true);

  // ─── Shared detail panel ─────────────────────────────────────────────
  readonly selectedMarkerId = signal<string | null>(null);
  readonly selectedDetail = signal<CatalystDetail | null>(null);
  readonly detailLoading = signal(false);

  // ─── Filtered views (computed) ───────────────────────────────────────

  readonly lastSyncedAt = computed<string | null>(() => {
    const raw = this.rawData();
    if (!raw) return null;
    let latest: string | null = null;
    for (const company of raw.companies) {
      for (const asset of company.assets ?? []) {
        for (const trial of asset.trials ?? []) {
          const ts = trial.ctgov_last_synced_at;
          if (ts && (!latest || ts > latest)) latest = ts;
        }
      }
    }
    return latest;
  });

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
    // Read signals first so the effect tracks them, even when we skip writing.
    const state: PersistedLandscapeState = {
      filters: this.filters(),
      zoomLevel: this.zoomLevel(),
      spokeMode: this.spokeMode(),
      spokeGrouping: this.spokeGrouping(),
      heatmapGrouping: this.heatmapGrouping(),
      countUnit: this.countUnit(),
      showMoaColumn: this.showMoaColumn(),
      showRoaColumn: this.showRoaColumn(),
      showNotesColumn: this.showNotesColumn(),
    };
    if (!this.storageKey || this.disablePersistence) return;
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
  async init(
    spaceId: string,
    opts?: {
      disablePersistence?: boolean;
      columnDefaults?: {
        showMoaColumn?: boolean;
        showRoaColumn?: boolean;
        showNotesColumn?: boolean;
      };
    }
  ): Promise<void> {
    this.spaceId = spaceId;
    this.spaceIdSig.set(spaceId);
    try {
      this.showPreclinical.set(await this.spaceSettings.getShowPreclinical(spaceId));
    } catch {
      this.showPreclinical.set(false);
    }
    this.disablePersistence = opts?.disablePersistence ?? false;
    this.storageKey = STORAGE_PREFIX + spaceId;
    if (opts?.columnDefaults) {
      if (opts.columnDefaults.showMoaColumn !== undefined)
        this.showMoaColumn.set(opts.columnDefaults.showMoaColumn);
      if (opts.columnDefaults.showRoaColumn !== undefined)
        this.showRoaColumn.set(opts.columnDefaults.showRoaColumn);
      if (opts.columnDefaults.showNotesColumn !== undefined)
        this.showNotesColumn.set(opts.columnDefaults.showNotesColumn);
    }
    if (!this.disablePersistence) {
      this.restorePersistedState();
    }
    await this.loadData();
  }

  /** Reload the dataset (e.g. after data mutation). */
  async reload(): Promise<void> {
    await this.loadData();
  }

  /**
   * Select a marker and fetch its detail. In-app clicks toggle (clicking the
   * already-selected row closes the drawer); deep links must force-open via
   * openMarker() so an existing selection from restored sessionStorage doesn't
   * close the drawer on the user.
   */
  async selectMarker(markerId: string): Promise<void> {
    if (this.selectedMarkerId() === markerId) {
      this.clearSelection();
      return;
    }
    await this.fetchAndSet(markerId);
  }

  /**
   * Force-open the detail drawer for a marker. Used by deep links
   * (e.g. ?markerId= from the activity feed) where toggle semantics would
   * close a drawer that the URL just asked to open.
   */
  async openMarker(markerId: string): Promise<void> {
    if (this.selectedMarkerId() === markerId && this.selectedDetail() !== null) {
      // Already open with detail loaded; nothing to do.
      return;
    }
    await this.fetchAndSet(markerId);
  }

  private async fetchAndSet(markerId: string): Promise<void> {
    this.selectedMarkerId.set(markerId);
    this.selectedDetail.set(null);
    this.detailLoading.set(true);
    try {
      const detail = await this.catalyst.getCatalystDetail(markerId);
      if (this.selectedMarkerId() === markerId) {
        this.selectedDetail.set(detail);
      }
    } catch {
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
        assetIds: null,
        indicationIds: null,
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
      if (saved.spokeGrouping) this.spokeGrouping.set(saved.spokeGrouping);
      if (saved.heatmapGrouping) this.heatmapGrouping.set(saved.heatmapGrouping);
      if (saved.countUnit) this.countUnit.set(saved.countUnit);
      if (typeof saved.showMoaColumn === 'boolean') this.showMoaColumn.set(saved.showMoaColumn);
      if (typeof saved.showRoaColumn === 'boolean') this.showRoaColumn.set(saved.showRoaColumn);
      if (typeof saved.showNotesColumn === 'boolean')
        this.showNotesColumn.set(saved.showNotesColumn);
    } catch {
      // Corrupt data -- ignore and start fresh.
    }
  }
}

// ─── Pure filtering functions ────────────────────────────────────────────

export function filterDashboardData(companies: Company[], filters: LandscapeFilters): Company[] {
  let result = companies;

  if (filters.companyIds.length > 0) {
    result = result.filter((c) => filters.companyIds.includes(c.id));
  }

  return result
    .map((c) => {
      let assets = c.assets ?? [];

      if (filters.assetIds.length > 0) {
        assets = assets.filter((p) => filters.assetIds.includes(p.id));
      }
      if (filters.mechanismOfActionIds.length > 0) {
        assets = assets.filter((p) =>
          (p.mechanisms_of_action ?? []).some((m) => filters.mechanismOfActionIds.includes(m.id))
        );
      }
      if (filters.routeOfAdministrationIds.length > 0) {
        assets = assets.filter((p) =>
          (p.routes_of_administration ?? []).some((r) =>
            filters.routeOfAdministrationIds.includes(r.id)
          )
        );
      }

      assets = assets
        .map((p) => {
          let trials = p.trials ?? [];

          if (filters.trialIds.length > 0) {
            trials = trials.filter((t) => filters.trialIds.includes(t.id));
          }

          // Indication filter: trials carry their indication grouping in
          // `_indication` (attached by DashboardService). Match on the
          // indication entity id, which is `_indication.indication_id` -- not
          // the asset_indication join-row id on `_indication.id`. Trials with
          // no `_indication` are excluded when an indication filter is active.
          if (filters.indicationIds.length > 0) {
            trials = trials.filter(
              (t) =>
                t._indication?.indication_id &&
                filters.indicationIds.includes(t._indication.indication_id)
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
          return { ...p, trials } as Asset;
        })
        .filter((p): p is Asset => p !== null);

      if (assets.length === 0) return null;
      return { ...c, assets } as Company;
    })
    .filter((c): c is Company => c !== null);
}

/**
 * Flatten the company > asset > trial > marker hierarchy into a flat
 * Catalyst[] array, keeping only markers with event_date >= today.
 */
function flattenToCatalysts(companies: Company[], today: string): Catalyst[] {
  const catalysts: Catalyst[] = [];

  for (const company of companies) {
    for (const asset of company.assets ?? []) {
      for (const trial of asset.trials ?? []) {
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
            marker_type_color: mt?.color ?? '',
            marker_type_shape: mt?.shape ?? 'circle',
            marker_type_inner_mark: mt?.inner_mark ?? 'none',
            is_projected: marker.is_projected,
            no_longer_expected: marker.no_longer_expected ?? false,
            company_name: company.name,
            company_id: company.id,
            asset_name: asset.name,
            asset_id: asset.id,
            trial_name: trial.name,
            trial_acronym: trial.acronym ?? null,
            trial_id: trial.id,
            trial_phase: trial.phase_type ?? trial.phase ?? null,
            description: marker.description ?? null,
            source_url: marker.source_url ?? null,
            trial_recent_changes_count: trial.recent_changes_count ?? 0,
            trial_most_recent_change_type: trial.most_recent_change_type ?? null,
            trial_most_recent_change_event_id: trial.most_recent_change_event_id ?? null,
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
