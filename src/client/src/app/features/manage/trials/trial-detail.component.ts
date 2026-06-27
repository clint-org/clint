import { DatePipe, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { Dialog } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';

import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { SourceProvenanceLineComponent } from '../../../shared/components/source-provenance/source-provenance-line.component';
import { sectionHashUrl } from './section-hash-url';
import { Trial } from '../../../core/models/trial.model';
import { Marker } from '../../../core/models/marker.model';
import { buildEntityActionMenu } from '../../../shared/entity-actions/entity-action-menu';
import { runEntityDelete } from '../../../shared/entity-actions/run-entity-delete';
import { phaseShortLabel } from '../../../core/models/phase-colors';
import { shouldShowTrialSecondaryName } from '../../../core/utils/display-fallbacks';
import { TrialService } from '../../../core/services/trial.service';
import { MarkerService } from '../../../core/services/marker.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { ChangeEventService } from '../../../core/services/change-event.service';
import { SpaceFieldVisibilityService } from '../../../core/services/space-field-visibility.service';
import {
  IntelligenceDetailBundle,
  ReferencedInRow,
} from '../../../core/models/primary-intelligence.model';
import { buildEntityRouterLink } from '../../../shared/utils/intelligence-router-link';
import { ChangeEvent } from '../../../core/models/change-event.model';
import {
  CTGOV_DETAIL_DEFAULT_PATHS,
  CTGOV_FIELD_CATALOGUE,
} from '../../../core/models/ctgov-field.model';

import { MarkerFormComponent } from './marker-form.component';
import { SectionCardComponent } from '../../../shared/components/section-card.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceBriefListComponent } from '../../../shared/components/intelligence-brief-list/intelligence-brief-list.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { IntelligenceHistoryPanelComponent } from '../../../shared/components/intelligence-history-panel/intelligence-history-panel.component';
import { WithdrawIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/withdraw-dialog.component';
import { PurgeIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/purge-dialog.component';
import { IntelligenceHistoryHost } from '../../../shared/components/intelligence-history-panel/history-panel-host';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';
import { CtgovFieldRendererComponent } from '../../../shared/components/ctgov-field-renderer/ctgov-field-renderer.component';
import { CtgovSourceTagComponent } from '../../../shared/components/ctgov-source-tag.component';
import { MarkerIconComponent } from '../../../shared/components/svg-icons/marker-icon.component';
import { ChangeEventRowComponent } from '../../../shared/components/change-event-row/change-event-row.component';
import { TrialEditDialogComponent } from './trial-edit-dialog.component';
import { fetchIndicationsSafe } from './trial-indications';
import { ctgovRemovedChip } from './ctgov-removed-chip';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { TimelineViewComponent } from '../../landscape/timeline-view.component';
import { EntityMarkerDrawerComponent } from '../../landscape/entity-marker-drawer.component';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { EntityEventsPanelComponent } from '../../../shared/components/entity-events-panel/entity-events-panel.component';
import { EMPTY_LANDSCAPE_FILTERS } from '../../../core/models/landscape.model';

@Component({
  selector: 'app-trial-detail',
  imports: [
    RouterLink,
    DatePipe,
    TableModule,
    ButtonModule,
    MessageModule,
    Dialog,
    TooltipModule,
    SkeletonComponent,
    SourceProvenanceLineComponent,
    MarkerFormComponent,
    SectionCardComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    BrandLogoComponent,
    IntelligenceBlockComponent,
    IntelligenceBriefListComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    IntelligenceHistoryPanelComponent,
    WithdrawIntelligenceDialogComponent,
    PurgeIntelligenceDialogComponent,
    MaterialsSectionComponent,
    CtgovFieldRendererComponent,
    CtgovSourceTagComponent,
    MarkerIconComponent,
    ChangeEventRowComponent,
    TrialEditDialogComponent,
    TimelineViewComponent,
    EntityMarkerDrawerComponent,
    EntityEventsPanelComponent,
  ],
  providers: [LandscapeStateService],
  templateUrl: './trial-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialDetailComponent implements OnDestroy {
  protected phaseLabel(p: string | null | undefined): string {
    return p ? phaseShortLabel(p) : '';
  }

  protected readonly ctgovRemovedChip = ctgovRemovedChip;

  protected readonly showSecondaryName = shouldShowTrialSecondaryName;

  private location = inject(Location);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private trialService = inject(TrialService);
  private markerService = inject(MarkerService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private readonly changeEventService = inject(ChangeEventService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  // Stable menu-item references per marker id, keyed with a prefix
  // (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  private readonly trialEffect = effect(() => {
    const t = this.trial();
    this.topbarState.entityTitle.set(t?.name ?? '');
    this.topbarState.entityContext.set(t?.identifier ?? '');
  });

  private readonly topbarActionsEffect = effect(() => {
    // Edit details (opens trial-edit-dialog) and Delete share the topbar
    // overflow kebab, matching the grid-row idiom. Inline per-field editing
    // is still the planned future state.
    const trial = this.trial();
    if (!trial || !this.spaceRole.canEdit()) {
      this.topbarState.overflowActions.set([]);
      return;
    }
    this.topbarState.overflowActions.set(
      buildEntityActionMenu({
        canEdit: true,
        editLabel: 'Edit details',
        onEdit: () => this.editingTrial.set(true),
        onDelete: () => void this.deleteTrial(trial),
      })
    );
  });

  private async deleteTrial(trial: Trial): Promise<void> {
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete trial',
        entityLabel: trial.acronym ?? trial.name,
        message: `Delete "${trial.acronym ?? trial.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.trialService.previewDelete(trial.id),
      delete: () => this.trialService.delete(trial.id),
      successSummary: 'Trial deleted.',
      onSuccess: () =>
        void this.router.navigate([
          '/t',
          this.tenantIdSig(),
          's',
          this.spaceIdSig(),
          'manage',
          'trials',
        ]),
      errorFallback: 'Could not delete trial. Check your connection and try again.',
    });
  }

  readonly editingTrial = signal(false);

  // Lightweight CT.gov existence probe so the trial-detail readonly view
  // surfaces "Not found at CT.gov" when an NCT was entered but doesn't
  // resolve. Triggered when the identifier changes; debounced through the
  // effect so a fast Sync round-trip doesn't double-fire.
  protected readonly nctValidity = signal<'unknown' | 'valid' | 'not_found' | 'error'>('unknown');
  private lastProbedNct: string | null = null;
  private readonly nctProbeEffect = effect(() => {
    const t = this.trial();
    const nct = t?.identifier ?? null;
    if (!nct) {
      this.nctValidity.set('unknown');
      this.lastProbedNct = null;
      return;
    }
    if (nct === this.lastProbedNct) return;
    this.lastProbedNct = nct;
    void (async () => {
      try {
        const res = await fetch(
          `https://clinicaltrials.gov/api/v2/studies/${encodeURIComponent(nct)}`
        );
        if (this.lastProbedNct !== nct) return;
        if (res.status === 404) this.nctValidity.set('not_found');
        else if (res.ok) this.nctValidity.set('valid');
        else this.nctValidity.set('error');
      } catch {
        if (this.lastProbedNct === nct) this.nctValidity.set('error');
      }
    })();
  });

  // Route paramMap as a signal so trialId reacts to in-place navigation
  // (clicking a LINKED trial chip on a trial detail page reuses this
  // component; the snapshot wouldn't have updated). The effect below
  // re-runs loadTrial / loadIntelligence whenever the id changes.
  private readonly paramMapSig = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  // Query params as a signal so ?marker=<id> opens the inline editor even on
  // a same-page navigation. The "Edit" action on the read-only marker drawer
  // round-trips through the URL; the trial id is unchanged, so loadTrial never
  // re-runs and a one-shot read would miss it (see markerEditParamEffect).
  private readonly queryParamMapSig = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly trial = signal<Trial | null>(null);
  readonly indications = signal<{ id: string; name: string }[]>([]);
  readonly trialId = computed(() => this.paramMapSig().get('id') ?? '');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  protected readonly legendVisible = signal(false);

  readonly addingMarker = signal(false);
  readonly editingMarker = signal<Marker | null>(null);

  // Primary intelligence
  readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  readonly intelligenceDrawerOpen = signal(false);
  // anchor_id of the brief currently open in the drawer; null = new brief
  protected readonly drawerAnchorId = signal<string | null>(null);

  protected readonly leadBrief = computed(() => {
    const briefs = this.intelligence()?.briefs;
    if (!briefs?.length) return null;
    return briefs.find((b) => b.is_lead) ?? briefs[0];
  });

  protected readonly otherBriefs = computed(() => {
    const briefs = this.intelligence()?.briefs;
    if (!briefs?.length) return [];
    const lead = briefs.find((b) => b.is_lead) ?? briefs[0];
    return briefs.filter((b) => b !== lead);
  });

  // Intelligence history (version list, withdraw / purge dialogs)
  protected readonly historyHost = new IntelligenceHistoryHost(this.intelligenceService);
  protected readonly withdrawDialogOpen = signal(false);
  protected readonly purgeDialogOpen = signal(false);
  protected readonly purgeAnchorMode = signal(false);
  protected readonly purgeTargetHeadline = signal('');
  protected readonly purgeTargetId = signal<string | null>(null);

  // CT.gov data + activity feed
  readonly snapshot = signal<{ payload: unknown; fetched_at: string } | null>(null);
  readonly trialActivity = signal<ChangeEvent[]>([]);
  readonly showAllCtgovModal = signal(false);
  readonly syncing = signal(false);

  // Per-space override of which CT.gov fields render below Phase / Recruitment
  // / Study type. Loaded once when the trial resolves; falls back to the
  // catalogue defaults when the space hasn't customized this surface.
  private readonly fieldVisibilityService = inject(SpaceFieldVisibilityService);
  private readonly perSpaceDetailPaths = signal<string[] | null>(null);
  readonly detailExtraPaths = computed(
    () => this.perSpaceDetailPaths() ?? CTGOV_DETAIL_DEFAULT_PATHS
  );
  readonly allCatalogPaths = CTGOV_FIELD_CATALOGUE.map((f) => f.path);

  protected readonly hasIntelligence = computed(() =>
    (this.intelligence()?.briefs.length ?? 0) > 0
  );

  protected readonly spaceIdSig = computed(() => this.trial()?.space_id ?? '');
  protected readonly tenantIdSig = computed(
    () => this.route.snapshot.paramMap.get('tenantId') ?? this.findAncestorParam('tenantId')
  );

  /** Router link to the anchor entity whose intelligence references this trial. */
  protected referencedRouterLink(ref: ReferencedInRow): unknown[] {
    return (
      buildEntityRouterLink(
        this.tenantIdSig(),
        this.spaceIdSig(),
        ref.entity_type,
        ref.entity_id
      ) ?? []
    );
  }

  private readonly landscape = inject(LandscapeStateService);

  private readonly landscapeInitEffect = effect(() => {
    const space = this.spaceIdSig();
    const trial = this.trial();
    if (!space || !trial) return;
    void this.initLandscape(space, trial.id);
  });

  private async initLandscape(spaceId: string, trialId: string): Promise<void> {
    await this.landscape.init(spaceId, {
      disablePersistence: true,
      columnDefaults: { showMoaColumn: false, showRoaColumn: false },
    });
    this.landscape.filters.set({ ...EMPTY_LANDSCAPE_FILTERS, trialIds: [trialId] });
  }

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  private readonly idChangeEffect = effect(() => {
    const id = this.trialId();
    if (!id) {
      this.error.set('No trial ID provided');
      this.loading.set(false);
      return;
    }
    this.error.set(null);
    void this.loadTrial();
    void this.loadIntelligence();
    void this.loadSnapshot();
    void this.loadTrialActivity();
    void this.loadFieldVisibility();
  });

  // When ?marker=<id> is present, open that marker in the inline editor and
  // scroll to the markers section. Markers have no detail page; the read-only
  // drawer's "Edit" action and catalyst-panel "Edit marker" both route here
  // via the URL. Reactive (not a one-shot in loadTrial) so it fires on a
  // same-page navigation where trialId is unchanged. The lastApplied guard
  // stops it re-opening after a save reloads the trial with the param still set.
  private lastAppliedMarkerParam: string | null = null;
  private readonly markerEditParamEffect = effect(() => {
    const markerId = this.queryParamMapSig().get('marker');
    const trial = this.trial();
    if (!trial) return;
    if (!markerId) {
      this.lastAppliedMarkerParam = null;
      return;
    }
    if (markerId === this.lastAppliedMarkerParam) return;
    const target = trial.markers?.find((m) => m.id === markerId);
    if (!target) return;
    this.lastAppliedMarkerParam = markerId;
    // Close the read-only drawer as we transition into editing.
    this.landscape.clearSelection();
    this.editingMarker.set(target);
    this.addingMarker.set(false);
    // Double-rAF defers the scroll until Angular has committed both the loaded
    // trial and the expanded editor, so #markers exists at its final height.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('markers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });

  // When ?markerId=<id> is present, open that marker in the read-only detail
  // drawer (the repo-wide deep-link convention used by the catalysts and
  // landscape pages). Distinct from ?marker=<id>, which opens the inline editor.
  // A material's MARKER chip deep-links here since markers have no standalone
  // page. openMarker (not selectMarker) so a restored selection of the same
  // marker is not toggled closed; the lastApplied guard stops it re-opening
  // after the user dismisses the drawer with the param still in the URL.
  private lastAppliedMarkerIdParam: string | null = null;
  private readonly markerViewParamEffect = effect(() => {
    const markerId = this.queryParamMapSig().get('markerId');
    const trial = this.trial();
    if (!trial) return;
    if (!markerId) {
      this.lastAppliedMarkerIdParam = null;
      return;
    }
    if (markerId === this.lastAppliedMarkerIdParam) return;
    this.lastAppliedMarkerIdParam = markerId;
    void this.landscape.openMarker(markerId);
  });

  /**
   * Open the read-only marker detail drawer (Field / Date type / Last synced /
   * source link) for a markers-table row, mirroring the embedded timeline's
   * marker click. The drawer's "Edit" action (editors only) round-trips through
   * ?marker=<id> to the inline editor via markerEditParamEffect.
   */
  protected viewMarkerDetail(marker: Marker): void {
    void this.landscape.selectMarker(marker.id);
  }

  private async loadFieldVisibility(): Promise<void> {
    const spaceId = this.route.snapshot.paramMap.get('spaceId');
    if (!spaceId) return;
    try {
      const map = await this.fieldVisibilityService.get(spaceId);
      const paths = map['trial_detail'];
      this.perSpaceDetailPaths.set(paths && paths.length > 0 ? paths : null);
    } catch {
      this.perSpaceDetailPaths.set(null);
    }
  }

  private async loadSnapshot(): Promise<void> {
    try {
      this.snapshot.set(await this.trialService.getLatestSnapshot(this.trialId()));
    } catch {
      this.snapshot.set(null);
    }
  }

  private async loadTrialActivity(): Promise<void> {
    try {
      this.trialActivity.set(await this.changeEventService.getTrialActivity(this.trialId(), 25));
    } catch {
      this.trialActivity.set([]);
    }
  }

  async syncCtgov(): Promise<void> {
    this.syncing.set(true);
    try {
      await this.changeEventService.triggerSingleTrialSync(this.trialId());
      await Promise.all([this.loadTrial(), this.loadSnapshot(), this.loadTrialActivity()]);
      this.messageService.add({
        severity: 'success',
        summary: 'Sync from CT.gov queued.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not sync from CT.gov',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    } finally {
      this.syncing.set(false);
    }
  }

  // Mirror the marker-icon fill rule used on the timeline grid and marker
  // drawer: projected markers render outline, actuals render filled. A marker
  // is projected when its is_projected flag is set or its projection is not
  // the literal 'actual'.
  protected markerFillStyle(marker: Marker): 'outline' | 'filled' {
    const projected =
      marker.is_projected || (!!marker.projection && marker.projection !== 'actual');
    return projected ? 'outline' : 'filled';
  }

  markerMenu(marker: Marker): MenuItem[] {
    const key = `marker:${marker.id}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;
    const items = buildEntityActionMenu({
      canEdit: this.spaceRole.canEdit(),
      editLabel: 'Edit',
      onEdit: () => {
        this.editingMarker.set(marker);
        this.addingMarker.set(false);
      },
      onDelete: () => void this.deleteMarker(marker.id),
    });
    this.menuCache.set(key, items);
    return items;
  }

  async onTrialEdited(updated: Trial): Promise<void> {
    // The dialog returns the bare row from PostgREST without the embedded
    // markers / notes / TA join, so reload through the full select instead
    // of trusting the partial. If the NCT changed, kick off a fresh sync so
    // the snapshot + materialized columns catch up to the new identifier.
    const previousIdentifier = this.trial()?.identifier ?? null;
    await this.loadTrial();
    if (updated.identifier && updated.identifier !== previousIdentifier) {
      this.changeEventService.triggerSingleTrialSync(updated.id).catch(() => undefined);
    }
  }

  async loadTrial(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.indications.set([]);
    const id = this.trialId();

    try {
      const trial = await this.trialService.getById(id);
      this.trial.set(trial);
      this.menuCache.clear();
      this.indications.set(await fetchIndicationsSafe(() => this.trialService.listIndications(id)));
      // History panel depends on the loaded trial's space_id; refresh once
      // the trial resolves so the inline panel reflects the latest versions.
      await this.refreshHistory();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load trial');
    } finally {
      this.loading.set(false);
    }
    // The inline editor for ?marker=<id> is opened reactively by
    // markerEditParamEffect once the trial (with its markers) resolves.
  }

  async loadIntelligence(): Promise<void> {
    try {
      const bundle = await this.intelligenceService.getTrialDetail(this.trialId());
      this.intelligence.set(bundle);
      // Refresh history now that the lead anchor_id is known.
      await this.refreshHistory();
    } catch {
      // Intelligence load failures shouldn't block the trial page; the
      // empty state simply renders. Real errors surface elsewhere.
      this.intelligence.set(null);
    }
  }

  private async refreshHistory(): Promise<void> {
    const t = this.trial();
    const anchorId = this.leadBrief()?.anchor_id;
    // Wait until both the trial and the lead anchor resolve.
    if (!t || !anchorId) return;
    try {
      await this.historyHost.load(anchorId, 'trial', t.id);
    } catch {
      // History panel mirrors the intelligence-block: load failures should
      // not block the page. The panel renders an empty state on its own.
    }
  }

  /** Load history for a non-lead brief when the user activates Version history. */
  protected async onViewHistory(anchorId: string): Promise<void> {
    const t = this.trial();
    if (!t) return;
    try {
      await this.historyHost.load(anchorId, 'trial', t.id);
    } catch {
      // Silent: panel shows its own empty state on load failure.
    }
  }

  protected async onWithdrawConfirmed(reason: string): Promise<void> {
    const id = this.historyHost.payload().current?.id;
    if (!id) return;
    try {
      await this.historyHost.withdraw(id, reason);
      this.withdrawDialogOpen.set(false);
      // Refresh the intelligence bundle for IntelligenceBlock and reload the
      // trial bundle (which also refreshes history) so the page reflects the
      // new state end-to-end.
      await Promise.all([this.loadIntelligence(), this.loadTrial()]);
      this.messageService.add({
        severity: 'success',
        summary: 'Intelligence withdrawn.',
        life: 3000,
      });
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Withdraw failed',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  protected onPurgeRequested(target: { id: string; headline: string }, anchor: boolean): void {
    this.purgeTargetId.set(target.id);
    this.purgeTargetHeadline.set(target.headline);
    this.purgeAnchorMode.set(anchor);
    this.purgeDialogOpen.set(true);
  }

  protected async onPurgeConfirmed(confirmation: string): Promise<void> {
    const id = this.purgeTargetId();
    if (!id) return;
    try {
      await this.historyHost.purge(id, confirmation, this.purgeAnchorMode());
      this.purgeDialogOpen.set(false);
      await Promise.all([this.loadIntelligence(), this.loadTrial()]);
      this.messageService.add({
        severity: 'success',
        summary: 'Intelligence purged.',
        life: 3000,
      });
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Purge failed',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  async onMarkerSaved(): Promise<void> {
    this.addingMarker.set(false);
    this.editingMarker.set(null);
    this.clearMarkerParam();
    await this.loadTrial();
    this.messageService.add({ severity: 'success', summary: 'Marker saved.', life: 3000 });
  }

  // Close the inline marker editor (cancel path) and drop any ?marker= param so
  // re-editing the same marker from the read-only drawer navigates cleanly
  // rather than hitting Angular's same-URL no-op.
  protected onMarkerEditClosed(): void {
    this.addingMarker.set(false);
    this.editingMarker.set(null);
    this.clearMarkerParam();
  }

  private clearMarkerParam(): void {
    if (!this.route.snapshot.queryParamMap.has('marker')) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { marker: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  async deleteMarker(id: string): Promise<void> {
    // Auto-derived markers (Trial Start / PCD / Trial End seeded by
    // ingest_ctgov_snapshot) get re-created on the next CT.gov sync because
    // the seeder dedups by "marker of this type already exists for this
    // trial". Surface that quirk in the confirm so analysts aren't surprised
    // by a resurrected marker on the next pull.
    const marker = this.trial()?.markers?.find((m) => m.id === id);
    const isCtgovSourced =
      (marker?.metadata as { source?: string } | null | undefined)?.source === 'ctgov';
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete marker',
      message: isCtgovSourced
        ? 'This marker was auto-derived from clinicaltrials.gov. Deleting it removes it from the timeline now, but the next CT.gov sync may re-create it. To suppress permanently, replace it with a manual marker of the same type.'
        : 'Delete this marker?',
      // Unnamed-item path: require the literal word 'delete' to enable
      // submit. Friction parity with named-entity deletes per cascade-safety T12.
      requireTypedConfirmation: true,
      typedConfirmationValue: 'delete',
    });
    if (!ok) return;
    try {
      await this.markerService.delete(id);
      await this.loadTrial();
      this.messageService.add({ severity: 'success', summary: 'Marker deleted.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not delete marker',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  onIntelligenceEdit(): void {
    this.drawerAnchorId.set(this.leadBrief()?.anchor_id ?? null);
    this.intelligenceDrawerOpen.set(true);
  }

  protected openDrawerForNewBrief(): void {
    this.drawerAnchorId.set(null);
    this.intelligenceDrawerOpen.set(true);
  }

  protected openBriefInDrawer(anchorId: string): void {
    this.drawerAnchorId.set(anchorId);
    this.intelligenceDrawerOpen.set(true);
  }

  protected async onBriefPin(anchorId: string): Promise<void> {
    const i = this.intelligence();
    if (!i) return;
    try {
      await this.intelligenceService.setLead(anchorId, i.space_id, i.entity_type, i.entity_id);
      await this.loadIntelligence();
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not set lead entry',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  protected async onBriefReorder(anchorIds: string[]): Promise<void> {
    const i = this.intelligence();
    if (!i) return;
    try {
      await this.intelligenceService.reorder(i.space_id, i.entity_type, i.entity_id, anchorIds);
      await this.loadIntelligence();
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not reorder entries',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  async onIntelligenceClosed(): Promise<void> {
    this.intelligenceDrawerOpen.set(false);
    await this.loadIntelligence();
  }

  async onIntelligencePublished(): Promise<void> {
    this.intelligenceDrawerOpen.set(false);
    await this.loadIntelligence();
    this.messageService.add({
      severity: 'success',
      summary: 'Intelligence published.',
      life: 3000,
    });
  }

  onIntelligenceDelete(): void {
    const lead = this.leadBrief();
    const id = lead?.published?.record.id ?? lead?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete this intelligence?',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Intelligence removed.',
          });
          await this.loadIntelligence();
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: (err as Error).message,
          });
        }
      },
    });
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  goBack(): void {
    this.location.back();
  }

  scrollToSection(event: Event, id: string): void {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Preserve the route path/query: a bare `#id` resolves against <base href="/">
    // and would drop the trial route (see sectionHashUrl).
    history.replaceState(null, '', sectionHashUrl(location.pathname, location.search, id));
  }
}
