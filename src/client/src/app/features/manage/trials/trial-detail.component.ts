import { DatePipe, Location } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { Dialog } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';

import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { Trial, TrialNote } from '../../../core/models/trial.model';
import { Marker } from '../../../core/models/marker.model';
import { TrialService } from '../../../core/services/trial.service';
import { MarkerService } from '../../../core/services/marker.service';
import { TrialNoteService } from '../../../core/services/trial-note.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { ChangeEventService } from '../../../core/services/change-event.service';
import { SpaceFieldVisibilityService } from '../../../core/services/space-field-visibility.service';
import { IntelligenceDetailBundle } from '../../../core/models/primary-intelligence.model';
import { ChangeEvent } from '../../../core/models/change-event.model';
import {
  CTGOV_DETAIL_DEFAULT_PATHS,
  CTGOV_FIELD_CATALOGUE,
} from '../../../core/models/ctgov-field.model';

import { MarkerFormComponent } from './marker-form.component';
import { NoteFormComponent } from './note-form.component';
import { SectionCardComponent } from '../../../shared/components/section-card.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { RecentActivityFeedComponent } from '../../../shared/components/recent-activity-feed/recent-activity-feed.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';
import { CtgovFieldRendererComponent } from '../../../shared/components/ctgov-field-renderer/ctgov-field-renderer.component';
import { CtgovSourceTagComponent } from '../../../shared/components/ctgov-source-tag.component';
import { ChangeEventRowComponent } from '../../../shared/components/change-event-row/change-event-row.component';
import { TrialEditDialogComponent } from './trial-edit-dialog.component';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

@Component({
  selector: 'app-trial-detail',
  standalone: true,
  imports: [
    DatePipe,
    TableModule,
    ButtonModule,
    MessageModule,
    Dialog,
    TooltipModule,
    SkeletonComponent,
    MarkerFormComponent,
    NoteFormComponent,
    SectionCardComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    IntelligenceBlockComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    RecentActivityFeedComponent,
    MaterialsSectionComponent,
    CtgovFieldRendererComponent,
    CtgovSourceTagComponent,
    ChangeEventRowComponent,
    TrialEditDialogComponent,
  ],
  templateUrl: './trial-detail.component.html',
})
export class TrialDetailComponent implements OnInit, OnDestroy {
  private location = inject(Location);
  private route = inject(ActivatedRoute);
  private trialService = inject(TrialService);
  private markerService = inject(MarkerService);
  private noteService = inject(TrialNoteService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private readonly changeEventService = inject(ChangeEventService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  // Stable menu-item references per row id, keyed with a prefix so markers
  // and notes don't collide (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  private readonly trialEffect = effect(() => {
    const t = this.trial();
    this.topbarState.entityTitle.set(t?.name ?? '');
    this.topbarState.entityContext.set(t?.identifier ?? '');
  });

  private readonly topbarActionsEffect = effect(() => {
    // Re-added an "Edit details" topbar action via the trial-edit-dialog
    // after the trial-form retirement left no UI path to fix typos /
    // backfill a missing NCT / reassign product or therapeutic area.
    // Inline per-field editing is still the planned future state.
    if (!this.trial() || !this.spaceRole.canEdit()) {
      this.topbarState.actions.set([]);
      return;
    }
    this.topbarState.actions.set([
      {
        label: 'Edit details',
        icon: 'fa-solid fa-pen',
        text: true,
        callback: () => this.editingTrial.set(true),
      },
    ]);
  });

  editingTrial = signal(false);

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

  trial = signal<Trial | null>(null);
  trialId = signal('');
  loading = signal(true);
  error = signal<string | null>(null);

  addingMarker = signal(false);
  editingMarker = signal<Marker | null>(null);
  addingNote = signal(false);
  editingNote = signal<TrialNote | null>(null);

  // Primary intelligence
  intelligence = signal<IntelligenceDetailBundle | null>(null);
  intelligenceDrawerOpen = signal(false);

  // CT.gov data + activity feed
  snapshot = signal<{ payload: unknown; fetched_at: string } | null>(null);
  trialActivity = signal<ChangeEvent[]>([]);
  showAllCtgovModal = signal(false);
  syncing = signal(false);

  // Per-space override of which CT.gov fields render below Phase / Recruitment
  // / Study type. Loaded once when the trial resolves; falls back to the
  // catalogue defaults when the space hasn't customized this surface.
  private readonly fieldVisibilityService = inject(SpaceFieldVisibilityService);
  private readonly perSpaceDetailPaths = signal<string[] | null>(null);
  detailExtraPaths = computed(() => this.perSpaceDetailPaths() ?? CTGOV_DETAIL_DEFAULT_PATHS);
  readonly allCatalogPaths = CTGOV_FIELD_CATALOGUE.map((f) => f.path);

  protected readonly hasIntelligence = computed(() => {
    const i = this.intelligence();
    return !!(i?.published || i?.draft);
  });

  protected readonly spaceIdSig = computed(() => this.trial()?.space_id ?? '');
  protected readonly tenantIdSig = computed(
    () => this.route.snapshot.paramMap.get('tenantId') ?? this.findAncestorParam('tenantId')
  );

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.trialId.set(id);
      this.loadTrial();
      this.loadIntelligence();
      void this.loadSnapshot();
      void this.loadTrialActivity();
      void this.loadFieldVisibility();
    } else {
      this.error.set('No trial ID provided');
      this.loading.set(false);
    }
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

  markerMenu(marker: Marker): MenuItem[] {
    const key = `marker:${marker.id}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => {
            this.editingMarker.set(marker);
            this.addingMarker.set(false);
          },
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.deleteMarker(marker.id),
        }
      );
    }
    this.menuCache.set(key, items);
    return items;
  }

  noteMenu(note: TrialNote): MenuItem[] {
    const key = `note:${note.id}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;
    const items: MenuItem[] = [];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => {
            this.editingNote.set(note);
            this.addingNote.set(false);
          },
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.deleteNote(note.id),
        }
      );
    }
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

    try {
      const trial = await this.trialService.getById(this.trialId());
      this.trial.set(trial);
      this.menuCache.clear();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load trial');
    } finally {
      this.loading.set(false);
    }
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

  async onMarkerSaved(): Promise<void> {
    this.addingMarker.set(false);
    this.editingMarker.set(null);
    await this.loadTrial();
    this.messageService.add({ severity: 'success', summary: 'Marker saved.', life: 3000 });
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
        : 'Delete this marker? This cannot be undone.',
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

  async onNoteSaved(): Promise<void> {
    this.addingNote.set(false);
    this.editingNote.set(null);
    await this.loadTrial();
    this.messageService.add({ severity: 'success', summary: 'Note saved.', life: 3000 });
  }

  async deleteNote(id: string): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete note',
      message: 'Delete this note? This cannot be undone.',
    });
    if (!ok) return;
    try {
      await this.noteService.delete(id);
      await this.loadTrial();
      this.messageService.add({ severity: 'success', summary: 'Note deleted.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not delete note',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  onIntelligenceEdit(): void {
    this.intelligenceDrawerOpen.set(true);
  }

  async onIntelligenceClosed(): Promise<void> {
    this.intelligenceDrawerOpen.set(false);
    await this.loadIntelligence();
  }

  async onIntelligencePublished(): Promise<void> {
    this.intelligenceDrawerOpen.set(false);
    await this.loadIntelligence();
    this.messageService.add({ severity: 'success', summary: 'Read published.', life: 3000 });
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
    history.replaceState(null, '', `#${id}`);
  }
}
