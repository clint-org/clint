import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Popover } from 'primeng/popover';

import { TrialNote } from '../../../core/models/trial.model';

@Component({
  selector: 'app-row-notes',
  standalone: true,
  imports: [DatePipe, Popover],
  template: `
    <div
      class="flex max-w-xs items-center gap-1 px-2 py-1 h-full"
      [class.cursor-pointer]="hasNotes()"
      (click)="hasNotes() && op.toggle($event)"
      (keydown.enter)="hasNotes() && op.toggle($event)"
      [tabindex]="hasNotes() ? 0 : -1"
      [attr.role]="hasNotes() ? 'button' : null"
    >
      @if (trialNotes()) {
        <span class="min-w-0 flex-1 truncate text-sm text-slate-700">
          {{ trialNotes() }}
        </span>
      } @else if (notes().length > 0) {
        <span class="min-w-0 flex-1 truncate text-sm text-slate-500">
          {{ notes()[0].content }}
        </span>
      }
      @if (totalCount() > 1) {
        <span
          class="flex-none rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
          aria-hidden="true"
        >
          {{ totalCount() }}
        </span>
      }
    </div>

    <p-popover #op ariaLabel="Trial notes">
      <div class="max-w-xs max-h-[300px] overflow-y-auto p-1">
        @if (totalCount() > 1) {
          <p class="text-xs text-slate-400 mb-2">{{ totalCount() }} notes</p>
        }
        @if (trialNotes()) {
          <p class="text-sm text-slate-700 mb-2">{{ trialNotes() }}</p>
        }
        @if (notes().length > 0) {
          <div class="flex flex-col gap-2">
            @for (note of notes(); track note.id) {
              <div class="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                <p class="text-sm text-slate-700">{{ note.content }}</p>
                <p class="text-xs text-slate-400 mt-0.5">{{ note.created_at | date }}</p>
              </div>
            }
          </div>
        }
      </div>
    </p-popover>
  `,
})
export class RowNotesComponent {
  notes = input<TrialNote[]>([]);
  trialNotes = input<string | null>(null);

  hasNotes = computed(() => !!this.trialNotes() || this.notes().length > 0);

  totalCount = computed(
    () => (this.trialNotes() ? 1 : 0) + this.notes().length,
  );
}
