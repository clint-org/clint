import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Textarea } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { TrialNote } from '../../../core/models/trial.model';
import { TrialNoteService } from '../../../core/services/trial-note.service';
import { extractConstraintMessage } from '../../../core/util/db-error';

const NOTE_FIELD_LABELS: Record<string, string> = {
  content: 'Content',
};

@Component({
  selector: 'app-note-form',
  standalone: true,
  imports: [FormsModule, Textarea, ButtonModule, MessageModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4">
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <div>
        <label for="note-content" class="block text-sm font-medium text-slate-700">
          Content <span aria-hidden="true" class="text-red-600">*</span>
        </label>
        <textarea
          pTextarea
          id="note-content"
          [(ngModel)]="content"
          name="content"
          rows="4"
          required
          aria-required="true"
          class="w-full mt-1"
          placeholder="Add a clinical observation, status update, or decision rationale..."
        ></textarea>
      </div>

      <div class="flex justify-end gap-2">
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="cancelled.emit()"
        />
        <p-button
          [label]="note() ? 'Update Note' : 'Add Note'"
          type="submit"
          [loading]="saving()"
          [disabled]="!canSubmit"
        />
      </div>
    </form>
  `,
})
export class NoteFormComponent implements OnInit {
  readonly note = input<TrialNote | null>(null);
  readonly trialId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private noteService = inject(TrialNoteService);
  private route = inject(ActivatedRoute);

  content = '';
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const existing = this.note();
    if (existing) {
      this.content = existing.content;
    }
  }

  get canSubmit(): boolean {
    return this.content.trim().length > 0;
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const existing = this.note();
      if (existing) {
        await this.noteService.update(existing.id, { content: this.content });
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.noteService.create(spaceId, {
          trial_id: this.trialId(),
          content: this.content,
        });
      }
      this.saved.emit();
    } catch (e) {
      const constraint = extractConstraintMessage(e, NOTE_FIELD_LABELS);
      if (constraint) {
        this.error.set(constraint);
      } else {
        this.error.set(
          e instanceof Error
            ? e.message
            : 'Could not save note. Check your connection and try again.'
        );
      }
    } finally {
      this.saving.set(false);
    }
  }
}
