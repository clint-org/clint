import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { Select } from 'primeng/select';
import { MultiSelect } from 'primeng/multiselect';
import { Checkbox } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Marker, MarkerCategory, MarkerType, Projection } from '../../../core/models/marker.model';
import { Trial } from '../../../core/models/trial.model';
import { MarkerService } from '../../../core/services/marker.service';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TrialService } from '../../../core/services/trial.service';

@Component({
  selector: 'app-marker-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    Textarea,
    Select,
    MultiSelect,
    Checkbox,
    ButtonModule,
    MessageModule,
  ],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4" aria-label="Marker form">
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <!-- Category -->
        <div>
          <label for="marker-category" class="block text-sm font-medium text-slate-700">
            Category
          </label>
          <p-select
            inputId="marker-category"
            [options]="categories()"
            [(ngModel)]="categoryId"
            name="categoryId"
            optionLabel="name"
            optionValue="id"
            placeholder="Select category"
            [style]="{ width: '100%' }"
            class="mt-1"
            (ngModelChange)="onCategoryChange($event)"
            [styleClass]="categoryId ? 'has-value' : ''"
          />
        </div>

        <!-- Marker Type -->
        <div>
          <label for="marker-type" class="block text-sm font-medium text-slate-700">
            Marker Type
          </label>
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
            [disabled]="!categoryId"
            (ngModelChange)="onMarkerTypeChange($event)"
            [styleClass]="markerTypeId ? 'has-value' : ''"
          />
        </div>

        <!-- Title -->
        <div class="sm:col-span-2">
          <label for="marker-title" class="block text-sm font-medium text-slate-700">
            Title <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          <input
            pInputText
            id="marker-title"
            class="w-full mt-1"
            [(ngModel)]="title"
            name="title"
            required
            aria-required="true"
          />
        </div>

        <!-- Projection -->
        <div>
          <label for="marker-projection" class="block text-sm font-medium text-slate-700">
            Projection
          </label>
          <p-select
            inputId="marker-projection"
            [options]="projectionOptions"
            [(ngModel)]="projection"
            name="projection"
            optionLabel="label"
            optionValue="value"
            placeholder="Select projection"
            [style]="{ width: '100%' }"
            class="mt-1"
            [styleClass]="projection ? 'has-value' : ''"
          />
        </div>

        <!-- Event Date -->
        <div>
          <label for="marker-event-date" class="block text-sm font-medium text-slate-700">
            Event Date <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          <input
            type="date"
            id="marker-event-date"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            [(ngModel)]="eventDate"
            name="eventDate"
            required
            aria-required="true"
          />
        </div>

        <!-- End Date -->
        <div>
          <label for="marker-end-date" class="block text-sm font-medium text-slate-700">
            End Date
          </label>
          <input
            type="date"
            id="marker-end-date"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            [(ngModel)]="endDate"
            name="endDate"
          />
        </div>

        <!-- Description -->
        <div class="sm:col-span-2">
          <label for="marker-description" class="block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            pTextarea
            id="marker-description"
            class="w-full mt-1"
            [(ngModel)]="description"
            name="description"
            rows="3"
          ></textarea>
        </div>

        <!-- Source URL -->
        <div class="sm:col-span-2">
          <label for="marker-source-url" class="block text-sm font-medium text-slate-700">
            Source URL
          </label>
          <input
            pInputText
            id="marker-source-url"
            class="w-full mt-1"
            [(ngModel)]="sourceUrl"
            name="sourceUrl"
            placeholder="https://..."
            type="url"
          />
        </div>

        <!-- Regulatory Pathway (only for FDA Submission marker type) -->
        @if (showRegulatoryPathway()) {
          <div class="sm:col-span-2">
            <label for="marker-pathway" class="block text-sm font-medium text-slate-700">
              Regulatory Pathway
            </label>
            <p-select
              inputId="marker-pathway"
              [options]="regulatoryPathwayOptions"
              [(ngModel)]="regulatoryPathway"
              name="regulatoryPathway"
              optionLabel="label"
              optionValue="value"
              placeholder="Select pathway"
              [style]="{ width: '100%' }"
              class="mt-1"
              [styleClass]="regulatoryPathway ? 'has-value' : ''"
            />
          </div>
        }

        <!-- Trial Assignment -->
        <div class="sm:col-span-2">
          <label for="marker-trials" class="block text-sm font-medium text-slate-700">
            Assign to Trials <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          <p-multiselect
            inputId="marker-trials"
            [options]="trials()"
            [(ngModel)]="selectedTrialIds"
            name="selectedTrialIds"
            optionLabel="name"
            optionValue="id"
            placeholder="Select trials"
            [style]="{ width: '100%' }"
            class="mt-1"
            (ngModelChange)="selectedTrialIds = ($event ?? [])"
            aria-required="true"
            [styleClass]="selectedTrialIds.length ? 'has-value' : ''"
            [maxSelectedLabels]="1"
            [selectedItemsLabel]="'Trial (' + selectedTrialIds.length + ')'"
          />
        </div>

        <!-- Notify Team -->
        <div class="sm:col-span-2">
          <div class="flex items-center gap-2">
            <p-checkbox
              [(ngModel)]="notifyTeam"
              name="notifyTeam"
              [binary]="true"
              inputId="marker-notify"
            />
            <label for="marker-notify" class="text-sm font-medium text-slate-700">
              Notify Team
            </label>
          </div>

          @if (notifyTeam) {
            <div class="mt-3 space-y-3 border-l-2 border-teal-200 pl-4">
              <div>
                <label for="notify-priority" class="block text-sm font-medium text-slate-700">
                  Priority
                </label>
                <p-select
                  inputId="notify-priority"
                  [options]="notifyPriorityOptions"
                  [(ngModel)]="notifyPriority"
                  name="notifyPriority"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Select priority"
                  [style]="{ width: '100%' }"
                  class="mt-1"
                  [styleClass]="notifyPriority ? 'has-value' : ''"
                />
              </div>
              <div>
                <label for="notify-summary" class="block text-sm font-medium text-slate-700">
                  Summary
                </label>
                <textarea
                  pTextarea
                  id="notify-summary"
                  class="w-full mt-1"
                  [(ngModel)]="notifySummary"
                  name="notifySummary"
                  rows="2"
                  placeholder="Brief summary for team notification..."
                ></textarea>
              </div>
            </div>
          }
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="cancelled.emit()"
          type="button"
        />
        <p-button
          [label]="marker() ? 'Update Marker' : 'Add Marker'"
          type="submit"
          [loading]="saving()"
        />
      </div>
    </form>
  `,
})
export class MarkerFormComponent implements OnInit {
  readonly marker = input<Marker | null>(null);
  readonly trialId = input<string>('');
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private markerService = inject(MarkerService);
  private markerCategoryService = inject(MarkerCategoryService);
  private markerTypeService = inject(MarkerTypeService);
  private notificationService = inject(NotificationService);
  private trialService = inject(TrialService);
  private route = inject(ActivatedRoute);

  readonly projectionOptions: { label: string; value: Projection }[] = [
    { label: 'Stout', value: 'stout' },
    { label: 'Company', value: 'company' },
    { label: 'Primary', value: 'primary' },
    { label: 'Actual', value: 'actual' },
  ];

  readonly regulatoryPathwayOptions = [
    { label: 'Standard', value: 'standard' },
    { label: 'Priority', value: 'priority' },
    { label: 'CNPV', value: 'cnpv' },
  ];

  readonly notifyPriorityOptions = [
    { label: 'Low', value: 'low' },
    { label: 'High', value: 'high' },
  ];

  categories = signal<MarkerCategory[]>([]);
  markerTypes = signal<MarkerType[]>([]);
  trials = signal<Trial[]>([]);
  showRegulatoryPathway = signal(false);

  // Form fields
  categoryId = '';
  markerTypeId = '';
  title = '';
  projection: Projection = 'actual';
  eventDate = '';
  endDate = '';
  description = '';
  sourceUrl = '';
  regulatoryPathway = '';
  selectedTrialIds: string[] = [];
  notifyTeam = false;
  notifyPriority: 'low' | 'high' = 'low';
  notifySummary = '';

  saving = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadData();

    const existing = this.marker();
    if (existing) {
      this.markerTypeId = existing.marker_type_id;
      this.title = existing.title;
      this.projection = existing.projection;
      this.eventDate = existing.event_date;
      this.endDate = existing.end_date ?? '';
      this.description = existing.description ?? '';
      this.sourceUrl = existing.source_url ?? '';
      this.regulatoryPathway =
        (existing.metadata as Record<string, string> | null)?.['pathway'] ?? '';

      // Pre-populate selected trials from existing assignments
      if (existing.marker_assignments) {
        this.selectedTrialIds = existing.marker_assignments.map(a => a.trial_id);
      }
    }

    // Pre-select trial from route context if provided
    const routeTrialId = this.trialId();
    if (routeTrialId && !this.selectedTrialIds.includes(routeTrialId)) {
      this.selectedTrialIds = [...this.selectedTrialIds, routeTrialId];
    }
  }

  private async loadData(): Promise<void> {
    const spaceId = this.getSpaceId();
    await Promise.all([
      this.loadCategories(spaceId),
      this.loadTrials(spaceId),
    ]);

    // If editing, resolve the category from the existing marker type
    const existing = this.marker();
    if (existing?.marker_types?.category_id) {
      this.categoryId = existing.marker_types.category_id;
      await this.loadMarkerTypesByCategory(existing.marker_types.category_id, spaceId);
    }
  }

  private async loadCategories(spaceId: string): Promise<void> {
    try {
      const cats = await this.markerCategoryService.list(spaceId);
      this.categories.set(cats);
    } catch {
      this.error.set('Could not load marker categories. Check your connection and try again.');
    }
  }

  private async loadMarkerTypesByCategory(categoryId: string, spaceId: string): Promise<void> {
    try {
      const types = await this.markerTypeService.listByCategory(categoryId, spaceId);
      this.markerTypes.set(types);
    } catch {
      this.error.set('Could not load marker types. Check your connection and try again.');
    }
  }

  private async loadTrials(spaceId: string): Promise<void> {
    try {
      const trialList = await this.trialService.listBySpace(spaceId);
      this.trials.set(trialList);
    } catch {
      this.error.set('Could not load trials. Check your connection and try again.');
    }
  }

  private getSpaceId(): string {
    // Walk up the route tree to find spaceId param
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('spaceId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }

  onCategoryChange(categoryId: string): void {
    this.markerTypeId = '';
    this.markerTypes.set([]);
    this.showRegulatoryPathway.set(false);
    if (categoryId) {
      const spaceId = this.getSpaceId();
      this.loadMarkerTypesByCategory(categoryId, spaceId);
    }
  }

  onMarkerTypeChange(typeId: string): void {
    const selected = this.markerTypes().find(t => t.id === typeId);
    this.showRegulatoryPathway.set(selected?.name === 'FDA Submission');
    if (!this.showRegulatoryPathway()) {
      this.regulatoryPathway = '';
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.markerTypeId || !this.title || !this.eventDate) return;
    if (this.selectedTrialIds.length === 0) {
      this.error.set('At least one trial must be assigned.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const spaceId = this.getSpaceId();

    const metadata: Record<string, unknown> | null = this.regulatoryPathway
      ? { pathway: this.regulatoryPathway }
      : null;

    const payload: Partial<Marker> = {
      marker_type_id: this.markerTypeId,
      title: this.title,
      projection: this.projection,
      event_date: this.eventDate,
      end_date: this.endDate || null,
      description: this.description || null,
      source_url: this.sourceUrl || null,
      metadata,
    };

    try {
      const existing = this.marker();
      let savedMarkerId: string;

      if (existing) {
        await this.markerService.update(existing.id, payload);
        await this.markerService.updateAssignments(existing.id, this.selectedTrialIds);
        savedMarkerId = existing.id;
      } else {
        const created = await this.markerService.create(spaceId, payload, this.selectedTrialIds);
        savedMarkerId = created.id;
      }

      if (this.notifyTeam && this.notifySummary.trim()) {
        await this.notificationService.createNotification(
          spaceId,
          savedMarkerId,
          this.notifyPriority,
          this.notifySummary.trim()
        );
      }

      this.saved.emit();
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not save marker. Check your connection and try again.'
      );
    } finally {
      this.saving.set(false);
    }
  }
}
