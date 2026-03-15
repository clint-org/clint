import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

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

@Component({
  selector: 'app-trial-detail',
  standalone: true,
  imports: [
    RouterLink,
    TableModule,
    ButtonModule,
    MessageModule,
    TrialFormComponent,
    PhaseFormComponent,
    MarkerFormComponent,
    NoteFormComponent,
  ],
  templateUrl: './trial-detail.component.html',
})
export class TrialDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private trialService = inject(TrialService);
  private phaseService = inject(TrialPhaseService);
  private markerService = inject(TrialMarkerService);
  private noteService = inject(TrialNoteService);

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

  async loadTrial(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const trial = await this.trialService.getById(this.trialId());
      this.trial.set(trial);
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
    try {
      await this.phaseService.delete(id);
      await this.loadTrial();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to delete phase');
    }
  }

  async onMarkerSaved(): Promise<void> {
    this.addingMarker.set(false);
    this.editingMarker.set(null);
    await this.loadTrial();
  }

  async deleteMarker(id: string): Promise<void> {
    try {
      await this.markerService.delete(id);
      await this.loadTrial();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to delete marker');
    }
  }

  async onNoteSaved(): Promise<void> {
    this.addingNote.set(false);
    this.editingNote.set(null);
    await this.loadTrial();
  }

  async deleteNote(id: string): Promise<void> {
    try {
      await this.noteService.delete(id);
      await this.loadTrial();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to delete note');
    }
  }
}
