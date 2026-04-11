import { Location } from '@angular/common';
import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { Trial, TrialPhase, TrialNote } from '../../../core/models/trial.model';
import { TrialMarker } from '../../../core/models/marker.model';
import { TrialService } from '../../../core/services/trial.service';
import { TrialPhaseService } from '../../../core/services/trial-phase.service';
import { TrialMarkerService } from '../../../core/services/trial-marker.service';
import { TrialNoteService } from '../../../core/services/trial-note.service';

import { TrialFormComponent } from './trial-form.component';
import { PhaseFormComponent } from './phase-form.component';
import { MarkerFormComponent } from './marker-form.component';
import { NoteFormComponent } from './note-form.component';
import { SectionCardComponent } from '../../../shared/components/section-card.component';
import { ColorSwatchComponent } from '../../../shared/components/color-swatch.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { confirmDelete } from '../../../shared/utils/confirm-delete';

@Component({
  selector: 'app-trial-detail',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    MessageModule,
    ProgressSpinnerModule,
    TrialFormComponent,
    PhaseFormComponent,
    MarkerFormComponent,
    NoteFormComponent,
    SectionCardComponent,
    ColorSwatchComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
  ],
  templateUrl: './trial-detail.component.html',
})
export class TrialDetailComponent implements OnInit {
  private location = inject(Location);
  private route = inject(ActivatedRoute);
  private trialService = inject(TrialService);
  private phaseService = inject(TrialPhaseService);
  private markerService = inject(TrialMarkerService);
  private noteService = inject(TrialNoteService);
  private confirmation = inject(ConfirmationService);

  // Stable menu-item references per row id, keyed with a prefix so phases,
  // markers, and notes don't collide (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  trial = signal<Trial | null>(null);
  trialId = signal('');
  loading = signal(true);
  error = signal<string | null>(null);

  editingTrial = signal(false);
  addingPhase = signal(false);
  editingPhase = signal<TrialPhase | null>(null);
  addingMarker = signal(false);
  editingMarker = signal<TrialMarker | null>(null);
  addingNote = signal(false);
  editingNote = signal<TrialNote | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.trialId.set(id);
      this.loadTrial();
    } else {
      this.error.set('No trial ID provided');
      this.loading.set(false);
    }
  }

  phaseMenu(phase: TrialPhase): MenuItem[] {
    const key = `phase:${phase.id}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Edit',
        icon: 'fa-solid fa-pen',
        command: () => {
          this.editingPhase.set(phase);
          this.addingPhase.set(false);
        },
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.deletePhase(phase.id),
      },
    ];
    this.menuCache.set(key, items);
    return items;
  }

  markerMenu(marker: TrialMarker): MenuItem[] {
    const key = `marker:${marker.id}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;
    const items: MenuItem[] = [
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
      },
    ];
    this.menuCache.set(key, items);
    return items;
  }

  noteMenu(note: TrialNote): MenuItem[] {
    const key = `note:${note.id}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;
    const items: MenuItem[] = [
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
      },
    ];
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

  async onTrialSaved(): Promise<void> {
    this.editingTrial.set(false);
    await this.loadTrial();
  }

  async onPhaseSaved(): Promise<void> {
    this.addingPhase.set(false);
    this.editingPhase.set(null);
    await this.loadTrial();
  }

  async deletePhase(id: string): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete phase',
      message: 'Delete this phase? This cannot be undone.',
    });
    if (!ok) return;
    try {
      await this.phaseService.delete(id);
      await this.loadTrial();
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not delete phase. Check your connection and try again.'
      );
    }
  }

  async onMarkerSaved(): Promise<void> {
    this.addingMarker.set(false);
    this.editingMarker.set(null);
    await this.loadTrial();
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
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not delete marker. Check your connection and try again.'
      );
    }
  }

  async onNoteSaved(): Promise<void> {
    this.addingNote.set(false);
    this.editingNote.set(null);
    await this.loadTrial();
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
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not delete note. Check your connection and try again.'
      );
    }
  }

  goBack(): void {
    this.location.back();
  }
}
