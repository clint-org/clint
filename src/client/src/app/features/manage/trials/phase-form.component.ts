import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TrialPhase } from '../../../core/models/trial.model';
import { TrialPhaseService } from '../../../core/services/trial-phase.service';

@Component({
  selector: 'app-phase-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="phase-type" class="block text-sm font-medium text-slate-700">
            Phase Type
          </label>
          <select
            id="phase-type"
            [(ngModel)]="phaseType"
            name="phaseType"
            required
            aria-required="true"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="" disabled>Select phase type</option>
            @for (pt of phaseTypes; track pt) {
              <option [value]="pt">{{ pt }}</option>
            }
          </select>
        </div>

        <div>
          <label for="phase-label" class="block text-sm font-medium text-slate-700">
            Label
          </label>
          <input
            id="phase-label"
            type="text"
            [(ngModel)]="label"
            name="label"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            aria-label="Phase label"
          />
        </div>

        <div>
          <label for="phase-start-date" class="block text-sm font-medium text-slate-700">
            Start Date
          </label>
          <input
            id="phase-start-date"
            type="date"
            [(ngModel)]="startDate"
            name="startDate"
            required
            aria-required="true"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        <div>
          <label for="phase-end-date" class="block text-sm font-medium text-slate-700">
            End Date
          </label>
          <input
            id="phase-end-date"
            type="date"
            [(ngModel)]="endDate"
            name="endDate"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            aria-label="Phase end date"
          />
        </div>

        <div>
          <label for="phase-color" class="block text-sm font-medium text-slate-700">
            Color
          </label>
          <input
            id="phase-color"
            type="color"
            [(ngModel)]="color"
            name="color"
            class="mt-1 block h-10 w-20 cursor-pointer rounded-md border border-slate-300"
            aria-label="Phase color"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          (click)="cancelled.emit()"
          class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium
                 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2
                 focus:ring-teal-500 focus:ring-offset-2"
          aria-label="Cancel phase form"
        >
          Cancel
        </button>
        <button
          type="submit"
          [disabled]="saving()"
          class="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white
                 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500
                 focus:ring-offset-2 disabled:opacity-50"
          aria-label="Save phase"
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
export class PhaseFormComponent implements OnInit {
  readonly phase = input<TrialPhase | null>(null);
  readonly trialId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private phaseService = inject(TrialPhaseService);

  readonly phaseTypes = ['P1', 'P2', 'P3', 'P4', 'OBS'];

  phaseType = '';
  startDate = '';
  endDate = '';
  color = '#3b82f6';
  label = '';
  saving = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    const existing = this.phase();
    if (existing) {
      this.phaseType = existing.phase_type;
      this.startDate = existing.start_date;
      this.endDate = existing.end_date ?? '';
      this.color = existing.color ?? '#3b82f6';
      this.label = existing.label ?? '';
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.phaseType || !this.startDate) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const payload: Partial<TrialPhase> = {
        phase_type: this.phaseType,
        start_date: this.startDate,
        end_date: this.endDate || null,
        color: this.color || null,
        label: this.label || null,
      };

      const existing = this.phase();
      if (existing) {
        await this.phaseService.update(existing.id, payload);
      } else {
        await this.phaseService.create({ ...payload, trial_id: this.trialId() });
      }
      this.saved.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to save phase');
    } finally {
      this.saving.set(false);
    }
  }
}
