import { Component, input } from '@angular/core';

import { TrialNote } from '../../../core/models/trial.model';

@Component({
  selector: 'app-row-notes',
  standalone: true,
  template: `
    <div class="flex max-w-xs flex-col gap-0.5 px-2 py-1">
      @if (trialNotes()) {
        <span
          class="truncate text-sm text-slate-700"
          [title]="trialNotes()!"
        >
          {{ trialNotes() }}
        </span>
      }
      @if (notes().length > 0) {
        <div class="flex flex-col gap-0.5">
          @for (note of notes(); track note.id) {
            <span
              class="truncate text-sm text-slate-500"
              [title]="note.content"
            >
              {{ note.content }}
            </span>
          }
        </div>
      }
    </div>
  `,
})
export class RowNotesComponent {
  notes = input<TrialNote[]>([]);
  trialNotes = input<string | null>(null);
}
