import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Checkbox } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { MarkerType, TrialMarker } from '../../../core/models/marker.model';
import { TrialMarkerService } from '../../../core/services/trial-marker.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';

@Component({
  selector: 'app-marker-form',
  standalone: true,
  imports: [FormsModule, InputText, Select, Checkbox, ButtonModule, MessageModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4">
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="marker-type" class="block text-sm font-medium text-slate-700"
            >Marker Type</label
          >
          <p-select
            inputId="marker-type"
            [options]="markerTypes()"
            [(ngModel)]="markerTypeId"
            name="markerTypeId"
            optionLabel="name"
            optionValue="id"
            placeholder="Select marker type"
            [style]="{ width: '100%' }"
            class="mt-1"
          />
        </div>

        <div>
          <label for="marker-event-date" class="block text-sm font-medium text-slate-700"
            >Event Date</label
          >
          <input
            type="date"
            id="marker-event-date"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            [(ngModel)]="eventDate"
            name="eventDate"
            required
          />
        </div>

        <div>
          <label for="marker-end-date" class="block text-sm font-medium text-slate-700"
            >End Date</label
          >
          <input
            type="date"
            id="marker-end-date"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            [(ngModel)]="endDate"
            name="endDate"
          />
        </div>

        <div>
          <label for="marker-tooltip" class="block text-sm font-medium text-slate-700"
            >Tooltip Text</label
          >
          <input
            pInputText
            id="marker-tooltip"
            class="w-full mt-1"
            [(ngModel)]="tooltipText"
            name="tooltipText"
          />
        </div>

        <div>
          <label for="marker-tooltip-image" class="block text-sm font-medium text-slate-700"
            >Tooltip Image URL</label
          >
          <input
            pInputText
            id="marker-tooltip-image"
            class="w-full mt-1"
            [(ngModel)]="tooltipImageUrl"
            name="tooltipImageUrl"
          />
        </div>

        <div class="flex items-center pt-6">
          <p-checkbox
            [(ngModel)]="isProjected"
            name="isProjected"
            [binary]="true"
            inputId="marker-projected"
          />
          <label for="marker-projected" class="ml-2 text-sm text-slate-700">Is Projected</label>
        </div>
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
export class MarkerFormComponent implements OnInit {
  readonly marker = input<TrialMarker | null>(null);
  readonly trialId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private markerService = inject(TrialMarkerService);
  private markerTypeService = inject(MarkerTypeService);
  private route = inject(ActivatedRoute);

  markerTypes = signal<MarkerType[]>([]);
  markerTypeId = '';
  eventDate = '';
  endDate = '';
  tooltipText = '';
  tooltipImageUrl = '';
  isProjected = false;
  saving = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadMarkerTypes();

    const existing = this.marker();
    if (existing) {
      this.markerTypeId = existing.marker_type_id;
      this.eventDate = existing.event_date;
      this.endDate = existing.end_date ?? '';
      this.tooltipText = existing.tooltip_text ?? '';
      this.tooltipImageUrl = existing.tooltip_image_url ?? '';
      this.isProjected = existing.is_projected;
    }
  }

  private async loadMarkerTypes(): Promise<void> {
    try {
      const types = await this.markerTypeService.list(this.route.snapshot.paramMap.get('spaceId')!);
      this.markerTypes.set(types);
    } catch {
      this.error.set('Failed to load marker types');
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.markerTypeId || !this.eventDate) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const payload: Partial<TrialMarker> = {
        marker_type_id: this.markerTypeId,
        event_date: this.eventDate,
        end_date: this.endDate || null,
        tooltip_text: this.tooltipText || null,
        tooltip_image_url: this.tooltipImageUrl || null,
        is_projected: this.isProjected,
      };

      const existing = this.marker();
      if (existing) {
        await this.markerService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.markerService.create(spaceId, { ...payload, trial_id: this.trialId() });
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save marker');
    } finally {
      this.saving.set(false);
    }
  }
}
