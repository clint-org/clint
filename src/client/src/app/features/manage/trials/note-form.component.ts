import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Textarea } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { TrialNote } from '../../../core/models/trial.model';
import { TrialNoteService } from '../../../core/services/trial-note.service';

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
        <label for="note-content" class="block text-sm font-medium text-slate-700">Content</label>
        <textarea
          pTextarea
          id="note-content"
          [(ngModel)]="content"
          name="content"
          rows="4"
          required
          class="w-full mt-1"
          placeholder="Enter note content"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2">
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="cancelled.emit()"
        />
        <p-button label="Save" type="submit" [loading]="saving()" />
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
  saving = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    const existing = this.note();
    if (existing) {
      this.content = existing.content;
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.content.trim()) return;

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
      this.error.set(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      this.saving.set(false);
    }
  }
}
