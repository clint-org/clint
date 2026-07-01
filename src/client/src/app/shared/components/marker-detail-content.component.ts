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
import { DatePipe } from '@angular/common';
import { ActivatedRoute, ActivatedRouteSnapshot, RouterLink } from '@angular/router';

import {
  CatalystDetail,
  CtgovMarkerMetadata,
  UpcomingMarker,
} from '../../core/models/event-detail.model';
import {
  ProjectionBadge,
  projectionBadge,
  projectionOutlineDash,
} from '../../core/models/marker-visual';
import { MarkerChangeRow } from '../../core/models/change-event.model';
import {
  CTGOV_FIELD_CATALOGUE,
  CTGOV_KEY_CATALYSTS_DEFAULT_PATHS,
  CTGOV_TIMELINE_DEFAULT_PATHS,
} from '../../core/models/ctgov-field.model';
import { ChangeEventService } from '../../core/services/change-event.service';
import { SpaceFieldVisibilityService } from '../../core/services/space-field-visibility.service';
import { SpaceRoleService } from '../../core/services/space-role.service';
import { TrialService } from '../../core/services/trial.service';
import { SourceProvenanceLineComponent } from './source-provenance/source-provenance-line.component';
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
import { DetailPanelEntityLinkDirective } from './detail-panel-entity-link.directive';
import { DetailPanelEntityListComponent } from './detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from './detail-panel-entity-row.component';
import { DetailPanelStatusBandComponent } from './detail-panel-status-band.component';
import { ExternalLinkComponent } from './external-link.component';
import { DetailPanelPillComponent, PillTone } from './detail-panel-pill.component';
import { DetailPanelSectionComponent } from './detail-panel-section.component';
import { PiDetailSectionComponent } from './pi-detail-section/pi-detail-section.component';
import { PiReference } from '../../core/models/primary-intelligence.model';
import { BrandLogoComponent } from './brand-logo.component';
import { MarkerIconComponent } from './svg-icons/marker-icon.component';
import { MaterialsSectionComponent } from './materials-section/materials-section.component';
import { PhaseChipComponent } from './phase-chip.component';

export type CtgovMarkerSurfaceKey = 'timeline_detail' | 'key_catalysts_panel';

interface ProjectionPill {
  text: string;
  tone: PillTone;
}

interface CtgovProvenanceBlock {
  field: string;
  fieldLabel: string;
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
    BrandLogoComponent,
    CtgovFieldRendererComponent,
    CtgovSourceTagComponent,
    DatePipe,
    DetailPanelEntityLinkDirective,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelHistoryComponent,
    DetailPanelPillComponent,
    DetailPanelSectionComponent,
    PiDetailSectionComponent,
    DetailPanelStatusBandComponent,
    ExternalLinkComponent,
    MarkerIconComponent,
    MaterialsSectionComponent,
    PhaseChipComponent,
    SourceProvenanceLineComponent,
  ],
  template: `
    @if (detail(); as d) {
      <!-- Title block: bold title + CT.gov source tag. The marker title already
           leads with the trial and the Trial cell below is the canonical
           reference, so there is no separate trial eyebrow here. -->
      <div class="flex items-start justify-between gap-2">
        <h2 class="text-base font-semibold leading-snug text-slate-900">
          {{ d.catalyst.title }}
        </h2>
        <app-ctgov-source-tag [metadata]="d.catalyst.metadata" />
      </div>

      <!-- Focal status band: projected vs confirmed is the key data-quality
           signal, so it gets a full-width band rather than an inline pill. -->
      <div class="mt-3">
        <app-detail-panel-status-band
          [projected]="isProjectedStatus()"
          [date]="formattedDate(d.catalyst.event_date)"
          [source]="statusSource()"
          [labelOverride]="statusLabel()"
        />
      </div>
      @if (d.catalyst.no_longer_expected) {
        <div class="mt-2">
          <app-detail-panel-pill tone="slate">No longer expected</app-detail-panel-pill>
        </div>
      }

      <!-- Company / Asset / Trial affiliation. Company gets a full-width header
           cell (logo, or the building entity icon as fallback, + name); the
           Asset | Trial row sits beneath. Mirrors the building/capsule/flask
           entity vocabulary used in the nav and timeline. -->
      @if (
        d.catalyst.company_name ||
        d.catalyst.asset_name ||
        (d.catalyst.trial_acronym ?? d.catalyst.trial_name)
      ) {
        <div class="mt-4 border border-slate-200">
          <!-- Company header cell: the whole row (logo + name) is the link. -->
          @if (d.catalyst.company_name) {
            @if (d.catalyst.company_id && tenantIdSig() && spaceId()) {
              <a
                [routerLink]="[
                  '/t',
                  tenantIdSig(),
                  's',
                  spaceId(),
                  'profiles',
                  'companies',
                  d.catalyst.company_id,
                ]"
                appDetailPanelEntityLink
                class="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5"
              >
                <app-brand-logo
                  [url]="d.catalyst.company_logo_url"
                  [alt]="d.catalyst.company_name"
                  [width]="20"
                  [height]="20"
                  imgClass="h-5 w-5 flex-none rounded object-contain"
                >
                  <span class="flex h-5 w-5 flex-none items-center justify-center text-slate-400">
                    <i class="fa-solid fa-building text-[13px]" aria-hidden="true"></i>
                  </span>
                </app-brand-logo>
                <span class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide">
                  {{ d.catalyst.company_name }}
                </span>
              </a>
            } @else {
              <div class="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
                <app-brand-logo
                  [url]="d.catalyst.company_logo_url"
                  [alt]="d.catalyst.company_name"
                  [width]="20"
                  [height]="20"
                  imgClass="h-5 w-5 flex-none rounded object-contain"
                >
                  <span class="flex h-5 w-5 flex-none items-center justify-center text-slate-400">
                    <i class="fa-solid fa-building text-[13px]" aria-hidden="true"></i>
                  </span>
                </app-brand-logo>
                <span class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  {{ d.catalyst.company_name }}
                </span>
              </div>
            }
          }

          <div class="grid grid-cols-2">
            <!-- Asset cell -->
            <div class="min-w-0 border-r border-slate-200 px-3 py-2.5">
              <p
                class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
              >
                <i class="fa-solid fa-capsules text-[11px]" aria-hidden="true"></i>
                Asset
              </p>
              @if (d.catalyst.asset_name) {
                @if (d.catalyst.asset_id && tenantIdSig() && spaceId()) {
                  <a
                    [routerLink]="[
                      '/t',
                      tenantIdSig(),
                      's',
                      spaceId(),
                      'profiles',
                      'assets',
                      d.catalyst.asset_id,
                    ]"
                    appDetailPanelEntityLink
                    class="block truncate text-[12px]"
                  >
                    {{ d.catalyst.asset_name }}
                  </a>
                } @else {
                  <span class="block truncate text-[12px] text-slate-700">
                    {{ d.catalyst.asset_name }}
                  </span>
                }
              } @else {
                <p class="text-[12px] text-slate-400">No asset linked</p>
              }
            </div>

            <!-- Trial cell -->
            <div class="min-w-0 px-3 py-2.5">
              <p
                class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
              >
                <i class="fa-solid fa-flask text-[11px]" aria-hidden="true"></i>
                Trial
              </p>
              @if (d.catalyst.trial_acronym ?? d.catalyst.trial_name; as trialLabel) {
                <!-- Trial name on its own full-width row so it is never
                     condensed by the phase pill (which now sits on the
                     status row below). -->
                @if (d.catalyst.trial_id; as trialId) {
                  <button
                    type="button"
                    class="group flex w-full items-center gap-1 text-left focus:outline-none focus:ring-1 focus:ring-brand-500"
                    (click)="trialClick.emit(trialId)"
                  >
                    <span
                      class="truncate text-[13px] font-medium text-slate-900 group-hover:text-brand-700"
                      >{{ trialLabel }}</span
                    >
                    <i
                      class="fa-solid fa-arrow-right shrink-0 text-[10px] text-slate-300 group-hover:text-brand-600"
                      aria-hidden="true"
                    ></i>
                  </button>
                } @else {
                  <span class="block truncate text-[13px] font-medium text-slate-900">{{
                    trialLabel
                  }}</span>
                }
                <!-- Status + phase: status sits left, phase chip right-aligned. -->
                @if (d.catalyst.recruitment_status || d.catalyst.trial_phase) {
                  <div class="mt-1 flex items-center gap-2">
                    @if (d.catalyst.recruitment_status) {
                      <p class="min-w-0 truncate text-[11px] text-slate-500">
                        {{ d.catalyst.recruitment_status }}
                      </p>
                    }
                    <app-phase-chip class="ml-auto" [phase]="d.catalyst.trial_phase" />
                  </div>
                }
              } @else {
                <p class="text-[12px] text-slate-400">No trial linked</p>
              }
            </div>
          </div>
        </div>
      }

      <!-- CT.gov field overlay: kept as its own small block below the grid. -->
      @if (ctgovPaths().length > 0 && snapshotPayload(); as snap) {
        <app-detail-panel-section label="Trial fields">
          <div class="text-[12px]">
            <app-ctgov-field-renderer [snapshot]="snap" [paths]="ctgovPaths()" [dense]="true" />
          </div>
        </app-detail-panel-section>
      }

      @if (d.catalyst.description && !isAutoDescription(d.catalyst.description)) {
        <app-detail-panel-section label="Description">
          <p class="text-[13px] leading-relaxed text-slate-700">{{ d.catalyst.description }}</p>
        </app-detail-panel-section>
      }

      <!-- Source provenance: the derived CT.gov registry link (registry_url is
           derived server-side, never stored) plus the attached citation list
           (sources). The legacy source_url is only a mid-transition fallback. -->
      @if (ctgovProvenance(); as prov) {
        <app-detail-panel-section label="Source">
          <dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px]">
            <dt class="text-slate-500">Field</dt>
            <dd class="text-slate-700">{{ prov.fieldLabel }}</dd>
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
          @if (registryUrl(); as reg) {
            <app-external-link [href]="reg" class="mt-2 block">
              View on ClinicalTrials.gov
            </app-external-link>
          }
          @if (citations().length > 0) {
            <ul class="mt-2 space-y-1">
              @for (src of citations(); track src.url) {
                <li>
                  <app-external-link [href]="src.url">{{
                    src.label || extractDomain(src.url)
                  }}</app-external-link>
                </li>
              }
            </ul>
          }
        </app-detail-panel-section>
      } @else if (registryUrl() || citations().length > 0 || d.catalyst.source_url) {
        <app-detail-panel-section label="Source">
          @if (registryUrl(); as reg) {
            <app-external-link [href]="reg" class="block">
              View on ClinicalTrials.gov
            </app-external-link>
          }
          @if (citations().length > 0) {
            <ul class="space-y-1" [class.mt-2]="registryUrl()">
              @for (src of citations(); track src.url) {
                <li>
                  <app-external-link [href]="src.url">{{
                    src.label || extractDomain(src.url)
                  }}</app-external-link>
                </li>
              }
            </ul>
          } @else if (!registryUrl() && d.catalyst.source_url) {
            <app-external-link [href]="d.catalyst.source_url">
              {{ extractDomain(d.catalyst.source_url) }}
            </app-external-link>
          }
        </app-detail-panel-section>
      }

      @if (d.catalyst.source_doc_id) {
        <div class="px-1 pt-1">
          <app-source-provenance-line
            [sourceDocId]="d.catalyst.source_doc_id"
            [canView]="canViewProvenance()"
          />
        </div>
      }

      @if (entityIntelligence().length > 0) {
        <app-detail-panel-section
          [label]="'Intelligence (' + entityIntelligence().length + ')'"
          [piMark]="true"
        >
          <app-pi-detail-section
            [references]="entityIntelligence()"
            (referenceClick)="onReferenceClick($event)"
          />
        </app-detail-panel-section>
      }

      @if (references().length > 0) {
        <app-detail-panel-section label="Referenced in intelligence" [piMark]="true">
          <app-pi-detail-section
            [references]="references()"
            [countLabel]="referenceCountLabel()"
            (referenceClick)="onReferenceClick($event)"
          />
        </app-detail-panel-section>
      }

      <!-- Program context: future then past events sharing this event's anchor
           (parent asset / company / space), mirroring the bullseye drawer's
           symmetric Upcoming / Recent split. -->
      @if (upcomingMarkers().length > 0) {
        <app-detail-panel-section label="Upcoming events">
          <app-detail-panel-entity-list>
            @for (um of upcomingMarkers(); track um.marker_id) {
              <app-detail-panel-entity-row (rowClick)="markerClick.emit(um.marker_id)">
                <app-marker-icon
                  class="mt-0.5 shrink-0 self-start"
                  [shape]="um.marker_type_shape"
                  [color]="um.marker_type_color"
                  [size]="12"
                  [fillStyle]="um.is_projected ? 'outline' : 'filled'"
                  [innerMark]="um.marker_type_inner_mark"
                  [isNle]="um.no_longer_expected"
                  [projectionBadge]="markerBadge(um)"
                  [outlineDash]="markerOutlineDash(um)"
                />
                <span class="w-[5.25rem] shrink-0 self-start font-mono text-[11px] font-semibold tabular-nums text-slate-500">{{
                  um.event_date | date: 'mediumDate'
                }}</span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-[12px] font-medium text-slate-700">{{
                    um.marker_type_name
                  }}</span>
                  @if (um.trial_acronym ?? um.trial_name; as trialLabel) {
                    <span class="truncate font-mono text-[10px] uppercase tracking-wide text-slate-400">{{
                      trialLabel
                    }}</span>
                  }
                </span>
                @if (um.is_projected) {
                  <span class="mt-0.5 shrink-0 self-start font-mono text-[9px] font-bold uppercase tracking-wider text-amber-600">Projected</span>
                }
              </app-detail-panel-entity-row>
            }
          </app-detail-panel-entity-list>
        </app-detail-panel-section>
      }

      @if (recentMarkers().length > 0) {
        <app-detail-panel-section label="Recent events">
          <app-detail-panel-entity-list>
            @for (rm of recentMarkers(); track rm.marker_id) {
              <app-detail-panel-entity-row (rowClick)="markerClick.emit(rm.marker_id)">
                <app-marker-icon
                  class="mt-0.5 shrink-0 self-start"
                  [shape]="rm.marker_type_shape"
                  [color]="rm.marker_type_color"
                  [size]="12"
                  [fillStyle]="rm.is_projected ? 'outline' : 'filled'"
                  [innerMark]="rm.marker_type_inner_mark"
                  [isNle]="rm.no_longer_expected"
                  [projectionBadge]="markerBadge(rm)"
                  [outlineDash]="markerOutlineDash(rm)"
                />
                <span class="w-[5.25rem] shrink-0 self-start font-mono text-[11px] font-semibold tabular-nums text-slate-500">{{
                  rm.event_date | date: 'mediumDate'
                }}</span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-[12px] font-medium text-slate-700">{{
                    rm.marker_type_name
                  }}</span>
                  @if (rm.trial_acronym ?? rm.trial_name; as trialLabel) {
                    <span class="truncate font-mono text-[10px] uppercase tracking-wide text-slate-400">{{
                      trialLabel
                    }}</span>
                  }
                </span>
                @if (rm.is_projected) {
                  <span class="mt-0.5 shrink-0 self-start font-mono text-[9px] font-bold uppercase tracking-wider text-amber-600">Projected</span>
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
                <svg width="14" height="14" class="shrink-0" aria-hidden="true">
                  <rect x="1.5" y="2" width="11" height="10" rx="1.5" class="fill-brand-600" />
                  <rect x="3.6" y="4.4" width="6.8" height="1.4" fill="#fff" />
                  <rect x="3.6" y="6.8" width="6.8" height="1.4" fill="#fff" />
                  <rect x="3.6" y="9.2" width="4.2" height="1.4" fill="#fff" />
                </svg>
                <span class="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-slate-500">{{
                  re.event_date | date: 'mediumDate'
                }}</span>
                <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-700">{{
                  re.title
                }}</span>
                <span class="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400">{{ re.category_name }}</span>
              </app-detail-panel-entity-row>
            }
          </app-detail-panel-entity-list>
        </app-detail-panel-section>
      }

      @if (spaceId()) {
        <section class="mt-3 border-t border-slate-100 pt-3">
          <app-materials-section
            heading="Materials"
            [hideWhenEmpty]="true"
            entityType="marker"
            [entityId]="d.catalyst.marker_id"
            [spaceId]="spaceId()!"
          />
        </section>
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
  private spaceRole = inject(SpaceRoleService);
  private route = inject(ActivatedRoute);

  /** Import provenance is for curators: owners and editors only. */
  protected readonly canViewProvenance = computed(() => this.spaceRole.canEdit());

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
  /**
   * Incoming primary-intelligence references for this marker: published PI
   * entries (owned by a trial/asset/company) that cite this catalyst. Markers
   * never own PI, so this pane only ever shows references, never an owned block.
   */
  readonly references = input<PiReference[]>([]);
  /**
   * Owned intelligence for this marker's parent trial and asset. Surfaced as an
   * "Intelligence" section so the timeline pane matches the bullseye/heatmap
   * panels, which show the selected entity's briefs.
   */
  readonly entityIntelligence = input<PiReference[]>([]);
  readonly markerClick = output<string>();
  readonly eventClick = output<string>();
  readonly trialClick = output<string>();
  /** Open an incoming PI reference's owning entity. */
  readonly openIntelligence = output<{ entityType: string; entityId: string }>();

  protected readonly referenceCountLabel = computed<string | null>(() => {
    const n = this.references().length;
    if (n === 0) return null;
    return `Referenced in ${n} intelligence ${n === 1 ? 'entry' : 'entries'}`;
  });

  protected onReferenceClick(ref: PiReference): void {
    this.openIntelligence.emit({ entityType: ref.entity_type, entityId: ref.entity_id });
  }

  /** True when the date is an estimate (projection pill tone is amber). */
  protected readonly isProjectedStatus = computed(
    () => this.projectionPill()?.tone === 'amber'
  );

  /**
   * Status-band label: just the status word (Projected / Confirmed). The
   * estimate source moves to the band's source line so the label never wraps.
   */
  protected readonly statusLabel = computed<string | null>(() => {
    const pill = this.projectionPill();
    if (!pill) return null;
    return pill.tone === 'amber' ? 'Projected' : 'Confirmed';
  });

  /**
   * Concise provenance string for the status band's source line. For a
   * projected marker this is the estimate source (company / Stout / primary);
   * for an auto-derived marker it is the CT.gov date-type label; null otherwise
   * (no invented copy).
   */
  protected readonly statusSource = computed<string | null>(() => {
    const projection = this.detail()?.catalyst.projection;
    const estimateSource: Record<string, string> = {
      forecasted: 'Forecasted',
      company: 'Company guidance',
      primary: 'Primary source estimate',
    };
    if (projection && estimateSource[projection]) return estimateSource[projection];
    return this.ctgovProvenance()?.dateTypeLabel ?? null;
  });

  /** Formats an ISO date the same way the inline meta strip did. */
  protected formattedDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

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
    const rawField = meta.field ?? '';
    const catalogueEntry = CTGOV_FIELD_CATALOGUE.find((f) => f.path === rawField);
    return {
      field: rawField,
      fieldLabel: catalogueEntry?.label ?? rawField,
      dateType,
      dateTypeLabel: dateType === 'ACTUAL' ? 'Actual' : 'Anticipated by sponsor',
    };
  });

  /** Derived CT.gov registry link emitted by get_event_detail (or null). */
  protected readonly registryUrl = computed<string | null>(
    () => this.detail()?.catalyst.registry_url ?? null
  );

  /** Attached citations from event_sources (empty when none are attached). */
  protected readonly citations = computed<{ url: string; label: string | null }[]>(
    () => this.detail()?.catalyst.sources ?? []
  );

  /** Future events sharing this event's anchor (parent asset / company / space). */
  protected readonly upcomingMarkers = computed(() => this.detail()?.upcoming_markers ?? []);
  /** Past events sharing the same anchor, most-recent first. Symmetric with upcoming. */
  protected readonly recentMarkers = computed(() => this.detail()?.recent_markers ?? []);

  /**
   * Projection tier badge / forecast dash for an Upcoming or Recent marker row,
   * so these glyphs match the timeline + header (same `app-marker-icon`, same
   * inputs). Upcoming/Recent markers share the parent event's anchor, so the
   * `primary`-on-non-trial nuance keys off the parent catalyst's anchor_type.
   */
  protected markerBadge(m: UpcomingMarker): ProjectionBadge {
    return projectionBadge(m.projection, this.detail()?.catalyst.anchor_type);
  }

  protected markerOutlineDash(m: UpcomingMarker): boolean {
    return projectionOutlineDash(m.projection);
  }

  protected isAutoDescription(desc: string): boolean {
    return desc.toLowerCase().startsWith('auto-derived from');
  }

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
