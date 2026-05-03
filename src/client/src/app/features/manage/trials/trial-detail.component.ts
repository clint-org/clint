import { DatePipe, Location } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { Dialog } from 'primeng/dialog';

import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { Trial, TrialNote } from '../../../core/models/trial.model';
import { Marker } from '../../../core/models/marker.model';
import { TrialService } from '../../../core/services/trial.service';
import { MarkerService } from '../../../core/services/marker.service';
import { TrialNoteService } from '../../../core/services/trial-note.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { ChangeEventService } from '../../../core/services/change-event.service';
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
import { ChangeEventRowComponent } from '../../../shared/components/change-event-row/change-event-row.component';
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
    ChangeEventRowComponent,
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
    // Edit-trial topbar action retired with the trial-form modal in Task 4.4.
    // Inline per-field editing is the future state (Phase 5/6).
    this.topbarState.actions.set([]);
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

  // Hard-coded to defaults for now; Task 6.1 will wire per-space visibility.
  detailExtraPaths = computed(() => CTGOV_DETAIL_DEFAULT_PATHS);
  readonly allCatalogPaths = CTGOV_FIELD_CATALOGUE.map((f) => f.path);

  protected readonly hasIntelligence = computed(() => {
    const i = this.intelligence();
    return !!(i?.published || i?.draft);
  });

  protected readonly spaceIdSig = computed(() => this.trial()?.space_id ?? '');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.trialId.set(id);
      this.loadTrial();
      this.loadIntelligence();
      void this.loadSnapshot();
      void this.loadTrialActivity();
    } else {
      this.error.set('No trial ID provided');
      this.loading.set(false);
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
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete marker',
      message: 'Delete this marker? This cannot be undone.',
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
