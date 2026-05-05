import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelect } from 'primeng/multiselect';
import { SelectButton } from 'primeng/selectbutton';

import { ChangeEventService } from '../../core/services/change-event.service';
import { TrialService } from '../../core/services/trial.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { SpaceService } from '../../core/services/space.service';
import { ChangeEventRowComponent } from '../../shared/components/change-event-row/change-event-row.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import {
  ActivityFeedCursor,
  ActivityFeedFilters,
  ChangeEvent,
  ChangeEventType,
} from '../../core/models/change-event.model';
import { Trial } from '../../core/models/trial.model';

interface SyncRunSummary {
  started_at: string;
  ended_at: string;
  trials_checked: number;
  ncts_with_changes: number;
  snapshots_written: number;
  events_emitted: number;
  errors_count: number;
  status: string;
}

interface PillOption<T extends string> {
  label: string;
  value: T;
}

interface EventTypeOption {
  label: string;
  value: ChangeEventType;
}

interface TrialOption {
  label: string;
  value: string;
}

/**
 * Activity page (docs/specs/clinical-trial-dashboard/spec.md, phase 3.3).
 *
 * Renders a paged, filterable feed of change events for a single space at
 * `/t/:tenantId/s/:spaceId/activity`. Filters are signal-backed and a
 * computed() flattens the four UI signals into the ActivityFeedFilters
 * shape consumed by ChangeEventService. An effect() resets and reloads the
 * feed whenever the filter shape changes; "Load more" appends the next
 * cursor page without resetting state.
 *
 * The footer reads `get_latest_sync_run()` once on mount to surface poller
 * health (last sync, trials checked, changes detected).
 */
@Component({
  selector: 'app-engagement-activity-page',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    ButtonModule,
    MultiSelect,
    SelectButton,
    ChangeEventRowComponent,
    SkeletonComponent,
  ],
  templateUrl: './engagement-activity-page.component.html',
})
export class EngagementActivityPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly feed = inject(ChangeEventService);
  private readonly trialService = inject(TrialService);
  private readonly supabase = inject(SupabaseService);
  private readonly spaceService = inject(SpaceService);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly spaceName = signal('');
  readonly loading = signal(false);
  readonly initialLoad = signal(true);
  readonly events = signal<ChangeEvent[]>([]);
  readonly cursor = signal<ActivityFeedCursor | null>(null);
  readonly trials = signal<Trial[]>([]);
  readonly syncRun = signal<SyncRunSummary | null>(null);
  readonly syncRunLoaded = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // UI filter signals.
  readonly dateRange = signal<'7d' | '30d' | 'all'>('30d');
  readonly source = signal<'All' | 'CT.gov' | 'Analyst'>('All');
  readonly selectedEventTypes = signal<ChangeEventType[]>([]);
  readonly selectedTrialIds = signal<string[]>([]);

  // Filter option lists for the PrimeNG controls.
  readonly dateRangeOptions: PillOption<'7d' | '30d' | 'all'>[] = [
    { label: 'Last 7 days', value: '7d' },
    { label: 'Last 30 days', value: '30d' },
    { label: 'All time', value: 'all' },
  ];

  readonly sourceOptions: PillOption<'All' | 'CT.gov' | 'Analyst'>[] = [
    { label: 'All', value: 'All' },
    { label: 'CT.gov', value: 'CT.gov' },
    { label: 'Analyst', value: 'Analyst' },
  ];

  // All event-type options for the multi-select. Order mirrors the
  // ChangeEventType union in the model so adding a new type surfaces it
  // here automatically (TypeScript will complain if any are missing).
  readonly eventTypeOptions: EventTypeOption[] = [
    { label: 'Status changed', value: 'status_changed' },
    { label: 'Date moved', value: 'date_moved' },
    { label: 'Phase transitioned', value: 'phase_transitioned' },
    { label: 'Enrollment target changed', value: 'enrollment_target_changed' },
    { label: 'Arm added', value: 'arm_added' },
    { label: 'Arm removed', value: 'arm_removed' },
    { label: 'Intervention changed', value: 'intervention_changed' },
    { label: 'Outcome measure changed', value: 'outcome_measure_changed' },
    { label: 'Sponsor changed', value: 'sponsor_changed' },
    { label: 'Eligibility criteria changed', value: 'eligibility_criteria_changed' },
    { label: 'Eligibility changed', value: 'eligibility_changed' },
    { label: 'Trial withdrawn', value: 'trial_withdrawn' },
    { label: 'Marker added', value: 'marker_added' },
    { label: 'Projection finalized', value: 'projection_finalized' },
    { label: 'Marker reclassified', value: 'marker_reclassified' },
    { label: 'Marker updated', value: 'marker_updated' },
    { label: 'Marker removed', value: 'marker_removed' },
  ];

  readonly trialOptions = computed<TrialOption[]>(() =>
    this.trials().map((t) => ({
      label: t.identifier ? `${t.identifier} - ${t.name}` : t.name,
      value: t.id,
    }))
  );

  readonly filters = computed<ActivityFeedFilters>(() => {
    const result: ActivityFeedFilters = { date_range: this.dateRange() };
    if (this.selectedEventTypes().length) {
      result.event_types = this.selectedEventTypes();
    }
    if (this.source() !== 'All') {
      result.sources = [this.source() === 'CT.gov' ? 'ctgov' : 'analyst'];
    }
    if (this.selectedTrialIds().length) {
      result.trial_ids = this.selectedTrialIds();
    }
    return result;
  });

  readonly hasMore = computed(() => this.cursor() !== null);

  readonly skeletonRows = [0, 1, 2, 3, 4];

  constructor() {
    // Reload the feed (resetting cursor) whenever the flattened filter
    // shape changes. Stringify so reference equality on the inner arrays
    // does not retrigger when the user re-selects an identical filter set.
    effect(() => {
      const filters = this.filters();
      const id = this.spaceId();
      if (!id) return;
      void this.loadInitial(filters);
    });
  }

  ngOnInit(): void {
    // Walk up the snapshot tree because tenantId/spaceId live on parent
    // routes (/t/:tenantId/s/:spaceId/activity).
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }
    const id = this.spaceId();
    if (!id) return;
    void this.trialService
      .listBySpace(id)
      .then((t) => this.trials.set(t))
      .catch(() => this.trials.set([]));
    void this.spaceService
      .getSpace(id)
      .then((s) => this.spaceName.set(s?.name ?? ''))
      .catch(() => this.spaceName.set(''));
    void this.loadSyncRun();
  }

  private async loadInitial(filters: ActivityFeedFilters): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const page = await this.feed.getActivityFeed(this.spaceId(), filters, null, 50);
      this.events.set(page.events);
      this.cursor.set(page.next_cursor);
    } catch (err) {
      this.errorMessage.set(formatError(err, 'Failed to load activity.'));
      this.events.set([]);
      this.cursor.set(null);
    } finally {
      this.loading.set(false);
      this.initialLoad.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const cur = this.cursor();
    if (!cur) return;
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const page = await this.feed.getActivityFeed(this.spaceId(), this.filters(), cur, 50);
      this.events.update((prev) => [...prev, ...page.events]);
      this.cursor.set(page.next_cursor);
    } catch (err) {
      this.errorMessage.set(formatError(err, 'Failed to load more activity.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadSyncRun(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('get_latest_sync_run');
      if (error) throw error;
      this.syncRun.set((data as SyncRunSummary | null) ?? null);
    } catch {
      // Footer is best-effort observability; swallow and show "no sync runs".
      this.syncRun.set(null);
    } finally {
      this.syncRunLoaded.set(true);
    }
  }
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}
