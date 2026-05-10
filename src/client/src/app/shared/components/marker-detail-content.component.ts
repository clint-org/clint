import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, ActivatedRouteSnapshot, RouterLink } from '@angular/router';

import { CatalystDetail, CtgovMarkerMetadata } from '../../core/models/catalyst.model';
import { MarkerChangeRow } from '../../core/models/change-event.model';
import {
  CTGOV_KEY_CATALYSTS_DEFAULT_PATHS,
  CTGOV_TIMELINE_DEFAULT_PATHS,
} from '../../core/models/ctgov-field.model';
import { ChangeEventService } from '../../core/services/change-event.service';
import { SpaceFieldVisibilityService } from '../../core/services/space-field-visibility.service';
import { TrialService } from '../../core/services/trial.service';
import {
  MARKER_FIELD_LABELS,
  PROJECTION_LABEL,
  formatMarkerFieldValue,
} from '../utils/marker-fields';
import { CtgovFieldRendererComponent } from './ctgov-field-renderer/ctgov-field-renderer.component';
import { CtgovSourceTagComponent } from './ctgov-source-tag.component';
import {
  DetailPanelHistoryComponent,
  HistoryEntry,
  HistoryFieldDiff,
} from './detail-panel-history.component';
import { DetailPanelEntityListComponent } from './detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from './detail-panel-entity-row.component';
import { DetailPanelPillComponent, PillTone } from './detail-panel-pill.component';
import { DetailPanelSectionComponent } from './detail-panel-section.component';
import { MaterialsSectionComponent } from './materials-section/materials-section.component';

export type CtgovMarkerSurfaceKey = 'timeline_detail' | 'key_catalysts_panel';

interface ProjectionPill {
  text: string;
  tone: PillTone;
}

interface CtgovProvenanceBlock {
  field: string;
  dateType: 'ACTUAL' | 'ANTICIPATED';
  dateTypeLabel: string;
}

// Field-name and value vocabulary lives in shared/utils/marker-fields.ts so
// the History pane reads the same way as the activity feed and edit form.

@Component({
  selector: 'app-marker-detail-content',
  standalone: true,
  imports: [
    RouterLink,
    NgOptimizedImage,
    CtgovFieldRendererComponent,
    CtgovSourceTagComponent,
    DatePipe,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelHistoryComponent,
    DetailPanelPillComponent,
    DetailPanelSectionComponent,
    MaterialsSectionComponent,
  ],
  template: `
    @if (detail(); as d) {
      <!-- Title + CT.gov source tag -->
      <div class="flex items-start justify-between gap-2">
        <h2 class="text-base font-semibold leading-snug text-slate-900">
          {{ d.catalyst.title }}
        </h2>
        <app-ctgov-source-tag [metadata]="d.catalyst.metadata" variant="detailed" />
      </div>

      <!-- Meta strip: status pill + date + optional "no longer expected".
           Items align at baseline so the pill (with vertical padding) and
           the date text share a visual horizontal line instead of the
           pill sitting taller than the date. -->
      <div class="mt-2 flex flex-wrap items-baseline gap-2">
        @if (projectionPill(); as pill) {
          <app-detail-panel-pill [tone]="pill.tone">{{ pill.text }}</app-detail-panel-pill>
        }
        <span class="font-mono text-[11px] tabular-nums leading-none text-slate-500">
          {{ d.catalyst.event_date | date: 'mediumDate' }}
        </span>
        @if (d.catalyst.no_longer_expected) {
          <app-detail-panel-pill tone="slate">No longer expected</app-detail-panel-pill>
        }
      </div>

      @if (d.catalyst.marker_id && tenantIdSig() && spaceId()) {
        <div class="mt-2 flex justify-end">
          <a
            [routerLink]="[
              '/t',
              tenantIdSig(),
              's',
              spaceId(),
              'manage',
              'markers',
              d.catalyst.marker_id,
            ]"
            class="font-mono text-[10px] uppercase tracking-wider text-brand-700 hover:underline"
          >
            View detail
          </a>
        </div>
      }

      @if (d.catalyst.company_name) {
        <app-detail-panel-section [first]="true" label="Program">
          <div class="flex items-center gap-2 text-[13px] text-slate-900">
            @if (d.catalyst.company_logo_url) {
              <img
                [ngSrc]="d.catalyst.company_logo_url"
                [alt]="d.catalyst.company_name"
                width="20"
                height="20"
                class="h-5 w-5 flex-none rounded object-contain"
              />
            }
            <p>
              @if (d.catalyst.company_id && tenantIdSig() && spaceId()) {
                <a
                  [routerLink]="[
                    '/t',
                    tenantIdSig(),
                    's',
                    spaceId(),
                    'manage',
                    'companies',
                    d.catalyst.company_id,
                  ]"
                  class="font-semibold uppercase text-brand-700 hover:underline"
                >
                  {{ d.catalyst.company_name }}
                </a>
              } @else {
                <span class="font-semibold uppercase">{{ d.catalyst.company_name }}</span>
              }
              @if (d.catalyst.product_name) {
                &middot;
                @if (d.catalyst.product_id && tenantIdSig() && spaceId()) {
                  <a
                    [routerLink]="[
                      '/t',
                      tenantIdSig(),
                      's',
                      spaceId(),
                      'manage',
                      'products',
                      d.catalyst.product_id,
                    ]"
                    class="text-brand-700 hover:underline"
                  >
                    {{ d.catalyst.product_name }}
                  </a>
                } @else {
                  {{ d.catalyst.product_name }}
                }
              }
            </p>
          </div>
        </app-detail-panel-section>
      }

      @if (d.catalyst.trial_name) {
        <app-detail-panel-section [first]="!d.catalyst.company_name" label="Trial">
          @if (d.catalyst.trial_id; as trialId) {
            <button
              type="button"
              class="group flex w-full flex-col items-start gap-0.5 text-left focus:outline-none focus:ring-1 focus:ring-brand-500"
              (click)="trialClick.emit(trialId)"
            >
              <span
                class="inline-flex items-center gap-1 text-[13px] font-medium text-slate-900 group-hover:text-brand-700"
              >
                {{ d.catalyst.trial_name }}
                <i
                  class="fa-solid fa-arrow-right text-[10px] text-slate-300 group-hover:text-brand-600"
                  aria-hidden="true"
                ></i>
              </span>
              <span class="text-[11px] text-slate-500">
                {{ d.catalyst.trial_phase }}
                @if (d.catalyst.recruitment_status) {
                  &middot; {{ d.catalyst.recruitment_status }}
                }
              </span>
            </button>
          } @else {
            <p class="text-[13px] font-medium text-slate-900">{{ d.catalyst.trial_name }}</p>
            <p class="text-[11px] text-slate-500">
              {{ d.catalyst.trial_phase }}
              @if (d.catalyst.recruitment_status) {
                &middot; {{ d.catalyst.recruitment_status }}
              }
            </p>
          }
          @if (ctgovPaths().length > 0 && snapshotPayload(); as snap) {
            <div class="mt-2 text-[12px]">
              <app-ctgov-field-renderer [snapshot]="snap" [paths]="ctgovPaths()" [dense]="true" />
            </div>
          }
        </app-detail-panel-section>
      }

      @if (d.catalyst.description) {
        <app-detail-panel-section label="Description">
          <p class="text-[13px] leading-relaxed text-slate-700">{{ d.catalyst.description }}</p>
        </app-detail-panel-section>
      }

      <!-- Source: unified treatment regardless of provenance shape -->
      @if (ctgovProvenance(); as prov) {
        <app-detail-panel-section label="Source">
          <p class="mb-1.5 text-[12px] text-slate-700">Auto-synced from clinicaltrials.gov</p>
          <dl class="mb-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px]">
            <dt class="text-slate-500">Field</dt>
            <dd class="font-mono text-slate-700">{{ prov.field }}</dd>
            <dt class="text-slate-500">Date type</dt>
            <dd
              [class.text-amber-700]="prov.dateType === 'ANTICIPATED'"
              [class.text-green-700]="prov.dateType === 'ACTUAL'"
            >
              {{ prov.dateTypeLabel }}
            </dd>
            @if (d.catalyst.ctgov_last_synced_at) {
              <dt class="text-slate-500">Last synced</dt>
              <dd class="text-slate-700">
                {{ d.catalyst.ctgov_last_synced_at | date: 'mediumDate' }}
              </dd>
            }
          </dl>
          @if (d.catalyst.source_url) {
            <a
              [href]="d.catalyst.source_url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-[12px] text-brand-700 hover:text-brand-800 hover:underline"
            >
              View on clinicaltrials.gov
              <i class="fa-solid fa-arrow-up-right-from-square text-[9px]" aria-hidden="true"></i>
            </a>
          }
        </app-detail-panel-section>
      } @else if (d.catalyst.source_url) {
        <app-detail-panel-section label="Source">
          <a
            [href]="d.catalyst.source_url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-[12px] text-brand-700 hover:text-brand-800 hover:underline"
          >
            {{ extractDomain(d.catalyst.source_url) }}
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]" aria-hidden="true"></i>
          </a>
        </app-detail-panel-section>
      }

      @if (d.upcoming_markers.length > 0) {
        <app-detail-panel-section label="Upcoming for this trial">
          <app-detail-panel-entity-list>
            @for (um of d.upcoming_markers; track um.marker_id) {
              <app-detail-panel-entity-row (rowClick)="markerClick.emit(um.marker_id)">
                <span class="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{{
                  um.event_date | date: 'MMM yyyy'
                }}</span>
                <span class="min-w-0 flex-1 truncate text-[12px] text-slate-700">{{
                  um.marker_type_name
                }}</span>
                @if (um.is_projected) {
                  <span class="shrink-0 text-[10px] font-medium text-amber-600">(projected)</span>
                }
              </app-detail-panel-entity-row>
            }
          </app-detail-panel-entity-list>
        </app-detail-panel-section>
      }

      @if (d.related_events.length > 0) {
        <app-detail-panel-section label="Related events">
          <app-detail-panel-entity-list>
            @for (re of d.related_events; track re.event_id) {
              <app-detail-panel-entity-row (rowClick)="eventClick.emit(re.event_id)">
                <span class="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{{
                  re.event_date | date: 'mediumDate'
                }}</span>
                <span class="min-w-0 flex-1 truncate text-[12px] text-slate-700">{{
                  re.title
                }}</span>
                <span class="shrink-0 text-[10px] text-slate-400">({{ re.category_name }})</span>
              </app-detail-panel-entity-row>
            }
          </app-detail-panel-entity-list>
        </app-detail-panel-section>
      }

      @if (spaceId()) {
        <app-detail-panel-section label="Materials">
          <app-materials-section
            entityType="marker"
            [entityId]="d.catalyst.marker_id"
            [spaceId]="spaceId()!"
          />
        </app-detail-panel-section>
      }

      <app-detail-panel-section>
        <app-detail-panel-history
          [entries]="historyEntries()"
          [loading]="historyLoading()"
          [open]="historyOpen()"
          (toggleOpen)="toggleHistory()"
        />
      </app-detail-panel-section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerDetailContentComponent {
  private changeEventService = inject(ChangeEventService);
  private trialService = inject(TrialService);
  private fieldVisibility = inject(SpaceFieldVisibilityService);
  private route = inject(ActivatedRoute);

  /**
   * Tenant id read from the route ancestry. Used to build the "View detail"
   * link to the marker detail page; the panel is mounted from
   * landscape-shell.component, which lives under /t/:tenantId/s/:spaceId.
   */
  protected readonly tenantIdSig = computed(() => {
    let snap: ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get('tenantId');
      if (v) return v;
      snap = snap.parent;
    }
    return '';
  });

  readonly detail = input<CatalystDetail | null>(null);
  /**
   * Optional space id. When set, a small Materials section renders for
   * materials linked to this marker.
   */
  readonly spaceId = input<string | null>(null);
  /**
   * Per-space CT.gov field surface this panel reads from. The parent picks
   * `key_catalysts_panel` or `timeline_detail` based on the active view.
   */
  readonly surfaceKey = input<CtgovMarkerSurfaceKey>('timeline_detail');
  readonly markerClick = output<string>();
  readonly eventClick = output<string>();
  readonly trialClick = output<string>();

  // Per-space CT.gov field overlay state. Snapshot is lazy-loaded by
  // trial_id whenever the selected marker (and therefore detail) changes;
  // visibility paths are loaded once per space + surface combination.
  protected readonly snapshotPayload = signal<unknown | null>(null);
  private readonly perSpacePaths = signal<string[] | null>(null);

  protected readonly ctgovPaths = computed(() => {
    const paths = this.perSpacePaths();
    if (paths !== null) return paths;
    return this.surfaceKey() === 'key_catalysts_panel'
      ? CTGOV_KEY_CATALYSTS_DEFAULT_PATHS
      : CTGOV_TIMELINE_DEFAULT_PATHS;
  });

  private readonly snapshotEffect = effect(() => {
    const trialId = this.detail()?.catalyst.trial_id ?? null;
    this.snapshotPayload.set(null);
    if (!trialId) return;
    void (async () => {
      try {
        const snap = await this.trialService.getLatestSnapshot(trialId);
        if (this.detail()?.catalyst.trial_id === trialId) {
          this.snapshotPayload.set(snap?.payload ?? null);
        }
      } catch {
        // snapshot block stays hidden on fetch failure
      }
    })();
  });

  private readonly visibilityEffect = effect(() => {
    const spaceId = this.spaceId();
    const key = this.surfaceKey();
    if (!spaceId) {
      this.perSpacePaths.set(null);
      return;
    }
    void (async () => {
      try {
        const map = await this.fieldVisibility.get(spaceId);
        const paths = map[key];
        this.perSpacePaths.set(paths && paths.length > 0 ? paths : null);
      } catch {
        this.perSpacePaths.set(null);
      }
    })();
  });

  protected readonly historyOpen = signal(false);
  protected readonly historyLoading = signal(false);
  private readonly historyRows = signal<MarkerChangeRow[] | null>(null);

  protected readonly historyEntries = computed<HistoryEntry[] | null>(() => {
    const rows = this.historyRows();
    if (rows === null) return null;
    return rows.map((row) => ({
      id: row.id,
      changeType: row.change_type,
      changedAt: row.changed_at,
      changedBy: row.changed_by_email,
      diffs: this.computeDiffs(row.old_values, row.new_values),
      raw: { old: row.old_values, new: row.new_values },
    }));
  });

  protected readonly projectionPill = computed<ProjectionPill | null>(() => {
    const c = this.detail()?.catalyst;
    if (!c) return null;
    if (c.projection) {
      const text = PROJECTION_LABEL[c.projection];
      return { text, tone: c.projection === 'actual' ? 'green' : 'amber' };
    }
    // Legacy markers without a projection enum: derive from is_projected.
    return c.is_projected
      ? { text: 'Projected', tone: 'amber' }
      : { text: 'Confirmed actual', tone: 'green' };
  });

  /**
   * Extracts the CT.gov provenance block when this marker was auto-derived
   * by sync. Returns null for analyst-created markers and for non-ctgov
   * metadata shapes (e.g. {pathway: 'priority'} on FDA Submission).
   */
  protected readonly ctgovProvenance = computed<CtgovProvenanceBlock | null>(() => {
    const m = this.detail()?.catalyst.metadata;
    if (!m) return null;
    const meta = m as Partial<CtgovMarkerMetadata>;
    if (meta.source !== 'ctgov') return null;
    const dateType: 'ACTUAL' | 'ANTICIPATED' =
      meta.ctgov_date_type === 'ACTUAL' ? 'ACTUAL' : 'ANTICIPATED';
    return {
      field: meta.field ?? '(unknown field)',
      dateType,
      dateTypeLabel: dateType === 'ACTUAL' ? 'Actual' : 'Anticipated by sponsor',
    };
  });

  protected extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  protected toggleHistory(): void {
    const next = !this.historyOpen();
    this.historyOpen.set(next);
    if (next && this.historyRows() === null && !this.historyLoading()) {
      this.loadHistory();
    }
  }

  private async loadHistory(): Promise<void> {
    const markerId = this.detail()?.catalyst.marker_id;
    if (!markerId) return;
    this.historyLoading.set(true);
    try {
      const rows = await this.changeEventService.getMarkerHistory(markerId);
      this.historyRows.set(rows);
    } catch {
      this.historyRows.set([]);
    } finally {
      this.historyLoading.set(false);
    }
  }

  /**
   * Walks the union of keys in old/new and emits a diff row for each field
   * that actually changed AND is in the displayable set. Skips id columns,
   * audit timestamps, and the metadata blob (which is too nested to diff
   * meaningfully without per-shape knowledge).
   */
  private computeDiffs(
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null
  ): HistoryFieldDiff[] {
    const allKeys = new Set<string>([
      ...Object.keys(oldValues ?? {}),
      ...Object.keys(newValues ?? {}),
    ]);
    const diffs: HistoryFieldDiff[] = [];
    for (const key of allKeys) {
      const label = MARKER_FIELD_LABELS[key];
      if (!label) continue;
      const before = oldValues?.[key] ?? null;
      const after = newValues?.[key] ?? null;
      if (this.deepEqual(before, after)) continue;
      diffs.push({
        field: key,
        label,
        before: formatMarkerFieldValue(key, before),
        after: formatMarkerFieldValue(key, after),
      });
    }
    return diffs;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
