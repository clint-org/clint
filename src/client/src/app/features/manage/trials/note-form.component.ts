import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TrialNote } from '../../../core/models/trial.model';
import { TrialNoteService } from '../../../core/services/trial-note.service';

@Component({
  selector: 'app-note-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4">
      <div>
        <label for="note-content" class="block text-sm font-medium text-gray-700">
          Content
        </label>
        <textarea
          id="note-content"
          [(ngModel)]="content"
          name="content"
          rows="4"
          required
          aria-required="true"
          class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm
                 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Enter note content"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          (click)="cancelled.emit()"
          class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium
                 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2
                 focus:ring-blue-500 focus:ring-offset-2"
          aria-label="Cancel note form"
        >
          Cancel
        </button>
        <button
          type="submit"
          [disabled]="saving()"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white
                 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                 focus:ring-offset-2 disabled:opacity-50"
          aria-label="Save note"
        >
          {{ saving() ? 'Saving...' : 'Save' }}
        </button>
      </div>

      @if (error()) {
        <p class="text-sm text-red-600" role="alert">{{ error() }}</p>
      }
    </form>
  `,
})
export class NoteFormComponent implements OnInit {
  readonly note = input<TrialNote | null>(null);
  readonly trialId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private noteService = inject(TrialNoteService);

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
        await this.noteService.create({
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
