import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';
import { Popover } from 'primeng/popover';

import { TrialNote } from '../../../core/models/trial.model';

@Component({
  selector: 'app-row-notes',
  standalone: true,
  imports: [DatePipe, Tooltip, Popover],
  template: `
    <div
      class="flex max-w-xs items-center gap-1 px-2 py-1 h-full"
      [class.cursor-pointer]="hasNotes()"
      [pTooltip]="tooltipText()"
      tooltipPosition="left"
      [tooltipOptions]="{ showDelay: 300 }"
      (click)="hasNotes() && op.toggle($event)"
      (keydown.enter)="hasNotes() && op.toggle($event)"
      [tabindex]="hasNotes() ? 0 : -1"
      [attr.role]="hasNotes() ? 'button' : null"
    >
      @if (trialNotes()) {
        <span class="truncate text-sm text-slate-700">
          {{ trialNotes() }}
        </span>
      } @else if (notes().length > 0) {
        <span class="truncate text-sm text-slate-500">
          {{ notes()[0].content }}
        </span>
      }
    </div>

    <p-popover #op ariaLabel="Trial notes">
      <div class="max-w-xs max-h-[300px] overflow-y-auto p-1">
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

  tooltipText = computed(() => {
    const parts: string[] = [];
    if (this.trialNotes()) parts.push(this.trialNotes()!);
    for (const note of this.notes()) {
      parts.push(note.content);
    }
    const full = parts.join(' | ');
    return full.length > 200 ? full.substring(0, 200) + '...' : full;
  });
}
