import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { ColorPicker } from 'primeng/colorpicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { TrialPhase } from '../../../core/models/trial.model';
import { TrialPhaseService } from '../../../core/services/trial-phase.service';

@Component({
  selector: 'app-phase-form',
  standalone: true,
  imports: [FormsModule, InputText, Select, DatePicker, ColorPicker, ButtonModule, MessageModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4">
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="phase-type" class="block text-sm font-medium text-slate-700">Phase Type</label>
          <p-select inputId="phase-type" [options]="phaseTypeOptions" [(ngModel)]="phaseType" name="phaseType" optionLabel="label" optionValue="value" placeholder="Select phase type" [style]="{ width: '100%' }" class="mt-1" />
        </div>

        <div>
          <label for="phase-label" class="block text-sm font-medium text-slate-700">Label</label>
          <input pInputText id="phase-label" class="w-full mt-1" [(ngModel)]="label" name="label" />
        </div>

        <div>
          <label for="phase-start-date" class="block text-sm font-medium text-slate-700">Start Date</label>
          <input type="date" id="phase-start-date" class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" [(ngModel)]="startDate" name="startDate" required />
        </div>

        <div>
          <label for="phase-end-date" class="block text-sm font-medium text-slate-700">End Date</label>
          <input type="date" id="phase-end-date" class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" [(ngModel)]="endDate" name="endDate" />
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Color</label>
          <p-colorpicker [(ngModel)]="color" name="color" />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="cancelled.emit()" />
        <p-button label="Save" type="submit" [loading]="saving()" />
      </div>
    </form>
  `,
})
export class PhaseFormComponent implements OnInit {
  readonly phase = input<TrialPhase | null>(null);
  readonly trialId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private phaseService = inject(TrialPhaseService);

  readonly phaseTypeOptions = [
    { label: 'P1', value: 'P1' },
    { label: 'P2', value: 'P2' },
    { label: 'P3', value: 'P3' },
    { label: 'P4', value: 'P4' },
    { label: 'OBS', value: 'OBS' },
  ];

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
