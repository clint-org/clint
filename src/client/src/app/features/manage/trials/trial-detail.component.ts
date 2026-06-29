import { DatePipe, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
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
import { buildEntityActionMenu } from '../../../shared/entity-actions/entity-action-menu';
import { runEntityDelete } from '../../../shared/entity-actions/run-entity-delete';
import { phaseShortLabel } from '../../../core/models/phase-colors';
import { shouldShowTrialSecondaryName } from '../../../core/utils/display-fallbacks';
import { TrialService } from '../../../core/services/trial.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { ChangeEventService } from '../../../core/services/change-event.service';
import { SpaceFieldVisibilityService } from '../../../core/services/space-field-visibility.service';
import {
  IntelligenceDetailBundle,
  IntelligenceHistoryPayload,
} from '../../../core/models/primary-intelligence.model';
import { ChangeEvent } from '../../../core/models/change-event.model';
import {
  CTGOV_DETAIL_DEFAULT_PATHS,
  CTGOV_FIELD_CATALOGUE,
} from '../../../core/models/ctgov-field.model';
import { deriveTrialPhaseSpan } from '../../../core/models/trial-phase-span';
import { selectTrialStartMarker, selectTrialEndMarker, isCtgovOwnedMarker } from '../../../core/models/trial-date-marker';
import { markerStartCaption } from '../../../core/models/marker-date-precision';

import { EventFormDialogComponent } from '../../events/event-form/event-form-dialog.component';
import { SectionCardComponent } from '../../../shared/components/section-card.component';
import { PiMarkComponent } from '../../../shared/components/pi-mark/pi-mark.component';
import { ReferencedInPanelComponent } from '../../../shared/components/referenced-in-panel/referenced-in-panel.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { IntelligenceStackComponent } from '../../../shared/components/intelligence-stack/intelligence-stack.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { WithdrawIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/withdraw-dialog.component';
import { PurgeIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/purge-dialog.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';
import { CtgovFieldRendererComponent } from '../../../shared/components/ctgov-field-renderer/ctgov-field-renderer.component';
import { CtgovSourceTagComponent } from '../../../shared/components/ctgov-source-tag.component';
import { MarkerIconComponent } from '../../../shared/components/svg-icons/marker-icon.component';
import { ChangeEventRowComponent } from '../../../shared/components/change-event-row/change-event-row.component';
import { TrialEditDialogComponent } from './trial-edit-dialog.component';
import { fetchIndicationsSafe } from './trial-indications';
import { ctgovRemovedChip } from './ctgov-removed-chip';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { TimelineViewComponent } from '../../landscape/timeline-view.component';
import { EntityMarkerDrawerComponent } from '../../landscape/entity-marker-drawer.component';
import { EntityEventsSectionComponent } from '../../../shared/components/entity-events-section/entity-events-section.component';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
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
    EventFormDialogComponent,
    SectionCardComponent,
    PiMarkComponent,
    ReferencedInPanelComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    BrandLogoComponent,
    IntelligenceStackComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
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
    EntityEventsSectionComponent,
  ],
  providers: [LandscapeStateService],
  templateUrl: './trial-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialDetailComponent {
  protected phaseLabel(p: string | null | undefined): string {
    return p ? phaseShortLabel(p) : '';
  }

  protected readonly ctgovRemovedChip = ctgovRemovedChip;

  protected readonly showSecondaryName = shouldShowTrialSecondaryName;

  private location = inject(Location);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private trialService = inject(TrialService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private readonly changeEventService = inject(ChangeEventService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  // Entity overflow menu (Edit details / Delete), rendered in the content
  // section-header instead of the topbar. Empty for viewers.
  protected readonly entityMenu = computed<MenuItem[]>(() => {
    const trial = this.trial();
    if (!trial || !this.spaceRole.canEdit()) return [];
    return buildEntityActionMenu({
      canEdit: true,
      editLabel: 'Edit details',
      onEdit: () => this.editingTrial.set(true),
      onDelete: () => void this.deleteTrial(trial),
    });
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
          'profiles',
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

  readonly trial = signal<Trial | null>(null);
  readonly indications = signal<{ id: string; name: string }[]>([]);
  readonly trialId = computed(() => this.paramMapSig().get('id') ?? '');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  protected readonly legendVisible = signal(false);

  // Primary intelligence
  readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  readonly intelligenceDrawerOpen = signal(false);
  // anchor_id of the brief currently open in the drawer; null = new brief
  protected readonly drawerAnchorId = signal<string | null>(null);

  // Per-anchor history map; populated lazily via onRequestHistory.
  protected readonly histories = signal<Record<string, IntelligenceHistoryPayload>>({});
  // Stores the published record id surfaced by the stack's withdraw output.
  protected readonly withdrawTargetId = signal<string | null>(null);

  // Intelligence history (version list, withdraw / purge dialogs)
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

  protected readonly phaseSpan = computed(() => deriveTrialPhaseSpan(this.trial()?.markers ?? []));

  protected readonly phaseStartMarker = computed(() =>
    selectTrialStartMarker(this.trial()?.markers ?? [])
  );
  protected readonly phaseEndMarker = computed(() =>
    selectTrialEndMarker(this.trial()?.markers ?? [])
  );

  protected readonly phaseStartSource = computed<'ctgov' | 'analyst' | null>(() => {
    const m = this.phaseStartMarker();
    if (!m) return null;
    return isCtgovOwnedMarker(m) ? 'ctgov' : 'analyst';
  });
  protected readonly phaseEndSource = computed<'ctgov' | 'analyst' | null>(() => {
    const m = this.phaseEndMarker();
    if (!m) return null;
    return isCtgovOwnedMarker(m) ? 'ctgov' : 'analyst';
  });

  protected readonly phaseStartLabel = computed(() => {
    const span = this.phaseSpan();
    if (!span.start) return null;
    return markerStartCaption(span.start, span.startPrecision);
  });
  protected readonly phaseEndLabel = computed(() => {
    const span = this.phaseSpan();
    if (!span.end) return null;
    return markerStartCaption(span.end, span.endPrecision);
  });

  protected readonly spaceIdSig = computed(() => this.trial()?.space_id ?? '');
  protected readonly tenantIdSig = computed(
    () => this.route.snapshot.paramMap.get('tenantId') ?? this.findAncestorParam('tenantId')
  );

  // Header count badge for the materials card, fed by the panel's (loaded)
  // output since the count is fetched inside the child component.
  protected readonly materialsCount = signal(0);

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
      this.indications.set(await fetchIndicationsSafe(() => this.trialService.listIndications(id)));
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
    } catch {
      // Intelligence load failures shouldn't block the trial page; the
      // empty state simply renders. Real errors surface elsewhere.
      this.intelligence.set(null);
    }
  }

  protected async onWithdrawConfirmed(reason: string): Promise<void> {
    const id = this.withdrawTargetId();
    if (!id) return;
    try {
      await this.intelligenceService.withdraw(id, reason);
      this.withdrawDialogOpen.set(false);
      await Promise.all([this.loadIntelligence(), this.loadTrial()]);
      this.histories.set({});
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
      await this.intelligenceService.purge(id, confirmation, this.purgeAnchorMode());
      this.purgeDialogOpen.set(false);
      await Promise.all([this.loadIntelligence(), this.loadTrial()]);
      this.histories.set({});
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

  /** Lazily loads version history for one anchor card; called by the stack on first expand. */
  protected async onRequestHistory(anchorId: string): Promise<void> {
    const t = this.trial();
    if (!t) return;
    try {
      const payload = await this.intelligenceService.loadHistory(anchorId, 'trial', t.id);
      this.histories.update((m) => ({ ...m, [anchorId]: payload }));
    } catch {
      // Per-card history load failure must not block the page; the card keeps
      // its loading line and the user can collapse/expand to retry.
    }
  }

  protected onWithdrawRequested(e: { anchorId: string; id: string; headline: string }): void {
    this.withdrawTargetId.set(e.id);
    this.withdrawDialogOpen.set(true);
  }

  protected onDiscardDraft(anchorId: string): void {
    const brief = this.intelligence()?.briefs.find((b) => b.anchor_id === anchorId);
    const id = brief?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Discard draft?',
      message: 'This permanently removes the unpublished draft. This cannot be undone.',
      acceptLabel: 'Discard draft',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({ severity: 'success', summary: 'Draft discarded.', life: 3000 });
          await this.loadIntelligence();
          this.histories.set({});
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Discard failed',
            detail: err instanceof Error ? err.message : 'Check your connection and try again.',
            life: 4000,
          });
        }
      },
    });
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
      this.histories.set({});
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
      this.histories.set({});
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
    this.histories.set({});
    this.messageService.add({
      severity: 'success',
      summary: 'Intelligence published.',
      life: 3000,
    });
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
