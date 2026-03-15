import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MarkerType, TrialMarker } from '../../../core/models/marker.model';
import { TrialMarkerService } from '../../../core/services/trial-marker.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';

@Component({
  selector: 'app-marker-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="marker-type" class="block text-sm font-medium text-slate-700">
            Marker Type
          </label>
          <select
            id="marker-type"
            [(ngModel)]="markerTypeId"
            name="markerTypeId"
            required
            aria-required="true"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="" disabled>Select marker type</option>
            @for (mt of markerTypes(); track mt.id) {
              <option [value]="mt.id">{{ mt.name }}</option>
            }
          </select>
        </div>

        <div>
          <label for="marker-event-date" class="block text-sm font-medium text-slate-700">
            Event Date
          </label>
          <input
            id="marker-event-date"
            type="date"
            [(ngModel)]="eventDate"
            name="eventDate"
            required
            aria-required="true"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        <div>
          <label for="marker-end-date" class="block text-sm font-medium text-slate-700">
            End Date
          </label>
          <input
            id="marker-end-date"
            type="date"
            [(ngModel)]="endDate"
            name="endDate"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            aria-label="Marker end date"
          />
        </div>

        <div>
          <label for="marker-tooltip" class="block text-sm font-medium text-slate-700">
            Tooltip Text
          </label>
          <input
            id="marker-tooltip"
            type="text"
            [(ngModel)]="tooltipText"
            name="tooltipText"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            aria-label="Marker tooltip text"
          />
        </div>

        <div>
          <label for="marker-tooltip-image" class="block text-sm font-medium text-slate-700">
            Tooltip Image URL
          </label>
          <input
            id="marker-tooltip-image"
            type="url"
            [(ngModel)]="tooltipImageUrl"
            name="tooltipImageUrl"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm
                   focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            aria-label="Marker tooltip image URL"
          />
        </div>

        <div class="flex items-center pt-6">
          <input
            id="marker-projected"
            type="checkbox"
            [(ngModel)]="isProjected"
            name="isProjected"
            class="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <label for="marker-projected" class="ml-2 text-sm text-slate-700">
            Is Projected
          </label>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          (click)="cancelled.emit()"
          class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium
                 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2
                 focus:ring-teal-500 focus:ring-offset-2"
          aria-label="Cancel marker form"
        >
          Cancel
        </button>
        <button
          type="submit"
          [disabled]="saving()"
          class="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white
                 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500
                 focus:ring-offset-2 disabled:opacity-50"
          aria-label="Save marker"
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
export class MarkerFormComponent implements OnInit {
  readonly marker = input<TrialMarker | null>(null);
  readonly trialId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private markerService = inject(TrialMarkerService);
  private markerTypeService = inject(MarkerTypeService);

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
      const types = await this.markerTypeService.list();
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
        await this.markerService.create({ ...payload, trial_id: this.trialId() });
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save marker');
    } finally {
      this.saving.set(false);
    }
  }
}
