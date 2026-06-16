import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { Select } from 'primeng/select';
import { MultiSelect } from 'primeng/multiselect';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Marker, MarkerCategory, MarkerType, Projection } from '../../../core/models/marker.model';
import { PROJECTION_LABEL } from '../../../shared/utils/marker-fields';
import { Trial } from '../../../core/models/trial.model';
import { MarkerService } from '../../../core/services/marker.service';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { TrialService } from '../../../core/services/trial.service';
import { extractConstraintMessage } from '../../../core/util/db-error';
import { toTrialOption, type TrialOption } from '../../../core/utils/to-trial-option';

const MARKER_FIELD_LABELS: Record<string, string> = {
  marker_type_id: 'Marker type',
  title: 'Title',
  event_date: 'Event date',
  trial_id: 'Assigned trial',
};

@Component({
  selector: 'app-marker-form',
  standalone: true,
  imports: [FormsModule, InputText, Textarea, Select, MultiSelect, ButtonModule, MessageModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4" aria-label="Marker form">
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <!-- Category -->
        <div>
          <label for="marker-category" class="block text-sm font-medium text-slate-700">
            Category <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          <p-select
            inputId="marker-category"
            [options]="categories()"
            [ngModel]="categoryId()"
            (ngModelChange)="onCategoryChange($event)"
            name="categoryId"
            optionLabel="name"
            optionValue="id"
            placeholder="Select category"
            styleClass="w-full"
            class="mt-1"
            [attr.aria-required]="true"
          />
        </div>

        <!-- Marker Type -->
        <div>
          <label for="marker-type" class="block text-sm font-medium text-slate-700">
            Marker Type <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          <p-select
            inputId="marker-type"
            [options]="markerTypes()"
            [ngModel]="markerTypeId()"
            (ngModelChange)="onMarkerTypeChange($event)"
            name="markerTypeId"
            optionLabel="name"
            optionValue="id"
            placeholder="Select marker type"
            styleClass="w-full"
            class="mt-1"
            [disabled]="!categoryId()"
            [attr.aria-required]="true"
          />
          @if (showCtgovAutoMarkerHint()) {
            <p class="mt-1 text-[11px] text-amber-700">
              Heads up: this marker type is auto-derived from clinicaltrials.gov when the trial
              syncs. A manual one created here will sit alongside the auto-derived one.
            </p>
          }
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
            [ngModel]="title()"
            (ngModelChange)="title.set($event)"
            name="title"
            required
            aria-required="true"
          />
        </div>

        <!-- Projection source -->
        <div>
          <label for="marker-projection" class="block text-sm font-medium text-slate-700">
            Projection source
          </label>
          <p-select
            inputId="marker-projection"
            [options]="projectionOptions"
            [ngModel]="projection()"
            (ngModelChange)="projection.set($event)"
            name="projection"
            optionLabel="label"
            optionValue="value"
            placeholder="Select source"
            styleClass="w-full"
            class="mt-1"
          />
          <p class="mt-1 text-xs text-slate-500">
            Where the date comes from. "Confirmed actual" renders filled; every projected source
            renders as an outline.
          </p>
        </div>

        <!-- Event Date -->
        <div>
          <label for="marker-event-date" class="block text-sm font-medium text-slate-700">
            Event Date <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          <input
            type="date"
            id="marker-event-date"
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            [ngModel]="eventDate()"
            (ngModelChange)="eventDate.set($event)"
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
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            [ngModel]="endDate()"
            (ngModelChange)="endDate.set($event)"
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
            [ngModel]="description()"
            (ngModelChange)="description.set($event)"
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
            [ngModel]="sourceUrl()"
            (ngModelChange)="sourceUrl.set($event)"
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
              [ngModel]="regulatoryPathway()"
              (ngModelChange)="regulatoryPathway.set($event)"
              name="regulatoryPathway"
              optionLabel="label"
              optionValue="value"
              placeholder="Select pathway"
              styleClass="w-full"
              class="mt-1"
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
            [options]="trialOptions()"
            [ngModel]="selectedTrialIds()"
            (ngModelChange)="selectedTrialIds.set($event ?? [])"
            name="selectedTrialIds"
            optionLabel="label"
            optionValue="id"
            placeholder="Select trials"
            [filter]="true"
            filterBy="label,identifier,companyName,assetName,briefTitle"
            styleClass="w-full"
            class="mt-1"
            aria-required="true"
            appendTo="body"
            [maxSelectedLabels]="0"
            [selectedItemsLabel]="'Trial (' + selectedTrialIds().length + ')'"
          >
            <ng-template let-opt pTemplate="item">
              <div class="flex flex-col py-0.5">
                <span class="text-sm text-slate-900">{{ opt.label }}</span>
                <span class="text-xs text-slate-500 truncate">
                  {{ opt.companyName }}
                  @if (opt.companyName && opt.assetName) {
                    <span class="mx-1">&middot;</span>
                  }
                  {{ opt.assetName }}
                  @if ((opt.companyName || opt.assetName) && opt.identifier) {
                    <span class="mx-1">&middot;</span>
                  }
                  <span class="font-mono">{{ opt.identifier }}</span>
                </span>
              </div>
            </ng-template>
          </p-multiselect>
          @if (selectedTrialIds().length === 0) {
            <p class="mt-1 text-xs text-slate-500">
              At least one trial. Markers always belong to a trial timeline.
            </p>
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
          [disabled]="!canSubmit()"
        />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerFormComponent implements OnInit {
  readonly marker = input<Marker | null>(null);
  readonly trialId = input<string>('');
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private markerService = inject(MarkerService);
  private markerCategoryService = inject(MarkerCategoryService);
  private markerTypeService = inject(MarkerTypeService);
  private trialService = inject(TrialService);
  private route = inject(ActivatedRoute);

  readonly projectionOptions: { label: string; value: Projection }[] = [
    { label: PROJECTION_LABEL['actual'], value: 'actual' },
    { label: PROJECTION_LABEL['stout'], value: 'stout' },
    { label: PROJECTION_LABEL['company'], value: 'company' },
    { label: PROJECTION_LABEL['primary'], value: 'primary' },
  ];

  readonly regulatoryPathwayOptions = [
    { label: 'Standard', value: 'standard' },
    { label: 'Priority', value: 'priority' },
    { label: 'CNPV', value: 'cnpv' },
  ];

  readonly categories = signal<MarkerCategory[]>([]);
  readonly markerTypes = signal<MarkerType[]>([]);
  readonly trials = signal<Trial[]>([]);
  protected readonly trialOptions = computed<TrialOption[]>(() =>
    this.trials().map(toTrialOption),
  );
  readonly showRegulatoryPathway = signal(false);

  // Form fields
  readonly categoryId = signal('');
  readonly markerTypeId = signal('');
  readonly title = signal('');
  readonly projection = signal<Projection>('actual');
  readonly eventDate = signal('');
  readonly endDate = signal('');
  readonly description = signal('');
  readonly sourceUrl = signal('');
  readonly regulatoryPathway = signal('');
  readonly selectedTrialIds = signal<string[]>([]);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly canSubmit = computed(
    () =>
      !!this.categoryId() &&
      !!this.markerTypeId() &&
      this.title().trim().length > 0 &&
      !!this.eventDate() &&
      this.selectedTrialIds().length > 0,
  );

  ngOnInit(): void {
    this.loadData();

    const existing = this.marker();
    if (existing) {
      this.markerTypeId.set(existing.marker_type_id);
      this.title.set(existing.title);
      this.projection.set(existing.projection);
      this.eventDate.set(existing.event_date);
      this.endDate.set(existing.end_date ?? '');
      this.description.set(existing.description ?? '');
      this.sourceUrl.set(existing.source_url ?? '');
      this.regulatoryPathway.set(
        (existing.metadata as Record<string, string> | null)?.['pathway'] ?? '',
      );

      // Pre-populate selected trials from existing assignments
      if (existing.marker_assignments) {
        this.selectedTrialIds.set(existing.marker_assignments.map((a) => a.trial_id));
      }
    }

    // Pre-select trial from route context if provided
    const routeTrialId = this.trialId();
    if (routeTrialId && !this.selectedTrialIds().includes(routeTrialId)) {
      this.selectedTrialIds.update((ids) => [...ids, routeTrialId]);
    }
  }

  private async loadData(): Promise<void> {
    const spaceId = this.getSpaceId();
    await Promise.all([this.loadCategories(spaceId), this.loadTrials(spaceId)]);

    // If editing, resolve the category from the existing marker type
    const existing = this.marker();
    if (existing?.marker_types?.category_id) {
      this.categoryId.set(existing.marker_types.category_id);
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
    this.categoryId.set(categoryId);
    this.markerTypeId.set('');
    this.markerTypes.set([]);
    this.showRegulatoryPathway.set(false);
    if (categoryId) {
      const spaceId = this.getSpaceId();
      this.loadMarkerTypesByCategory(categoryId, spaceId);
    }
  }

  onMarkerTypeChange(typeId: string): void {
    this.markerTypeId.set(typeId);
    const selected = this.markerTypes().find((t) => t.id === typeId);
    this.showRegulatoryPathway.set(selected?.name === 'FDA Submission');
    if (!this.showRegulatoryPathway()) {
      this.regulatoryPathway.set('');
    }
  }

  protected readonly showCtgovAutoMarkerHint = computed(() => {
    const typeId = this.markerTypeId();
    const selectedIds = this.selectedTrialIds();
    if (!typeId || selectedIds.length === 0) return false;
    const selectedType = this.markerTypes().find((t) => t.id === typeId);
    if (!selectedType) return false;
    const autoTypeName =
      selectedType.name === 'Trial Start' ||
      selectedType.name === 'Primary Completion Date (PCD)' ||
      selectedType.name === 'Trial End';
    if (!autoTypeName) return false;
    const selectedTrials = this.trials().filter((t) => selectedIds.includes(t.id));
    return selectedTrials.some((t) => !!t.identifier);
  });

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;

    this.saving.set(true);
    this.error.set(null);

    const spaceId = this.getSpaceId();

    const regulatoryPathway = this.regulatoryPathway();
    const metadata: Record<string, unknown> | null = regulatoryPathway
      ? { pathway: regulatoryPathway }
      : null;

    const payload: Partial<Marker> = {
      marker_type_id: this.markerTypeId(),
      title: this.title(),
      projection: this.projection(),
      event_date: this.eventDate(),
      end_date: this.endDate() || null,
      description: this.description() || null,
      source_url: this.sourceUrl() || null,
      metadata,
    };

    const trialIds = this.selectedTrialIds();

    try {
      const existing = this.marker();

      if (existing) {
        await this.markerService.update(existing.id, payload);
        await this.markerService.updateAssignments(existing.id, trialIds);
      } else {
        await this.markerService.create(spaceId, payload, trialIds);
      }

      this.saved.emit();
    } catch (err) {
      const constraint = extractConstraintMessage(err, MARKER_FIELD_LABELS);
      if (constraint) {
        this.error.set(constraint);
      } else {
        this.error.set(
          err instanceof Error
            ? err.message
            : 'Could not save marker. Check your connection and try again.'
        );
      }
    } finally {
      this.saving.set(false);
    }
  }
}
