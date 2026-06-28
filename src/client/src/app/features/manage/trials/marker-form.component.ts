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
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Marker, MarkerCategory, MarkerType, Projection } from '../../../core/models/marker.model';
import {
  type DatePrecision,
  DATE_PRECISION_LABELS,
  DATE_PRECISIONS,
  isApproximate,
  markerPeriodFromDate,
  precisionMidpointISO,
} from '../../../core/models/marker-date-precision';
import { isCtgovOwnedMarker } from '../../../core/models/trial-date-marker';
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
  imports: [FormsModule, InputText, Textarea, Select, ButtonModule, MessageModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4" aria-label="Marker form">
      @if (ctgovLocked()) {
        <p-message severity="warn" [closable]="false">
          This marker is managed by ClinicalTrials.gov and is read-only.
        </p-message>
      }
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
            [disabled]="ctgovLocked()"
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
            [disabled]="ctgovLocked() || !categoryId()"
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
            [disabled]="ctgovLocked()"
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
            [disabled]="ctgovLocked()"
          />
          <p class="mt-1 text-xs text-slate-500">
            Where the date comes from. "Confirmed actual" renders filled; every projected source
            renders as an outline.
          </p>
        </div>

        <!-- Date precision -->
        <div>
          <label for="marker-precision" class="block text-sm font-medium text-slate-700">
            Date precision
          </label>
          <p-select
            inputId="marker-precision"
            [options]="precisionOptions"
            [ngModel]="datePrecision()"
            (ngModelChange)="onPrecisionChange($event)"
            name="datePrecision"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
            class="mt-1"
            [disabled]="ctgovLocked()"
          />
        </div>

        <!-- Event Date / period -->
        <div>
          <label
            [attr.for]="datePrecision() === 'exact' ? 'marker-event-date' : null"
            class="block text-sm font-medium text-slate-700"
          >
            @if (datePrecision() === 'exact') {
              Event Date
            } @else {
              Period
            }
            <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          @if (datePrecision() === 'exact') {
            <input
              type="date"
              id="marker-event-date"
              class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              [ngModel]="eventDate()"
              (ngModelChange)="eventDate.set($event)"
              name="eventDate"
              required
              aria-required="true"
              [disabled]="ctgovLocked()"
            />
          } @else {
            <div class="mt-1 flex gap-2">
              @if (datePrecision() !== 'year') {
                <p-select
                  [options]="subOptions()"
                  [ngModel]="periodSub()"
                  (ngModelChange)="periodSub.set($event)"
                  name="periodSub"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="flex-1"
                  [attr.aria-label]="'Period within ' + datePrecision()"
                  [disabled]="ctgovLocked()"
                />
              }
              <input
                type="number"
                [ngModel]="periodYear()"
                (ngModelChange)="periodYear.set(+$event)"
                name="periodYear"
                min="2000"
                max="2100"
                aria-label="Year"
                class="w-24 rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                [disabled]="ctgovLocked()"
              />
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              Marked as approximate. Placed at the period midpoint
              ({{ effectiveEventDate() }}) on the timeline.
            </p>
          }
        </div>

        <!-- Extent: point, bounded end, or ongoing -->
        <div>
          <label for="marker-extent" class="block text-sm font-medium text-slate-700">
            Extent
          </label>
          <p-select
            inputId="marker-extent"
            [options]="extentOptions"
            [ngModel]="extent()"
            (ngModelChange)="onExtentChange($event)"
            name="extent"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
            class="mt-1"
            [disabled]="ctgovLocked()"
          />
          @if (extent() === 'onwards') {
            <p class="mt-1 text-[11px] text-slate-500">
              Open-ended: a tail fades into the future from the start.
            </p>
          }
        </div>

        @if (extent() === 'until') {
          <!-- End precision -->
          <div>
            <label for="marker-end-precision" class="block text-sm font-medium text-slate-700">
              End precision
            </label>
            <p-select
              inputId="marker-end-precision"
              [options]="precisionOptions"
              [ngModel]="endDatePrecision()"
              (ngModelChange)="onEndPrecisionChange($event)"
              name="endDatePrecision"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
              class="mt-1"
              [disabled]="ctgovLocked()"
            />
          </div>

          <!-- End date / period -->
          <div>
            <label
              [attr.for]="endDatePrecision() === 'exact' ? 'marker-end-date' : null"
              class="block text-sm font-medium text-slate-700"
            >
              Ends <span aria-hidden="true" class="text-red-600">*</span>
            </label>
            @if (endDatePrecision() === 'exact') {
              <input
                type="date"
                id="marker-end-date"
                class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                [ngModel]="endDate()"
                (ngModelChange)="endDate.set($event)"
                name="endDate"
                [disabled]="ctgovLocked()"
              />
            } @else {
              <div class="mt-1 flex gap-2">
                @if (endDatePrecision() !== 'year') {
                  <p-select
                    [options]="endSubOptions()"
                    [ngModel]="endPeriodSub()"
                    (ngModelChange)="endPeriodSub.set($event)"
                    name="endPeriodSub"
                    optionLabel="label"
                    optionValue="value"
                    styleClass="flex-1"
                    [attr.aria-label]="'End period within ' + endDatePrecision()"
                    [disabled]="ctgovLocked()"
                  />
                }
                <input
                  type="number"
                  [ngModel]="endPeriodYear()"
                  (ngModelChange)="endPeriodYear.set(+$event)"
                  name="endPeriodYear"
                  min="2000"
                  max="2100"
                  aria-label="End year"
                  class="w-24 rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  [disabled]="ctgovLocked()"
                />
              </div>
            }
            @if (!rangeValid()) {
              <p class="mt-1 text-[11px] text-red-700">End must be after the start.</p>
            }
          </div>
        }

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
            [disabled]="ctgovLocked()"
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
            [disabled]="ctgovLocked()"
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
              [disabled]="ctgovLocked()"
            />
          </div>
        }

        <!-- Trial Assignment -->
        <div class="sm:col-span-2">
          <label for="marker-trials" class="block text-sm font-medium text-slate-700">
            Assign to Trial <span aria-hidden="true" class="text-red-600">*</span>
          </label>
          <p-select
            inputId="marker-trials"
            [options]="trialOptions()"
            [ngModel]="selectedTrialId()"
            (ngModelChange)="selectedTrialId.set($event ?? '')"
            name="selectedTrialId"
            optionLabel="label"
            optionValue="id"
            placeholder="Select trial"
            [filter]="true"
            filterBy="label,identifier,companyName,assetName,briefTitle"
            styleClass="w-full"
            class="mt-1"
            aria-required="true"
            appendTo="body"
            [disabled]="ctgovLocked()"
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
          </p-select>
          @if (!selectedTrialId()) {
            <p class="mt-1 text-xs text-slate-500">
              Markers always belong to a trial timeline.
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
        @if (!ctgovLocked()) {
          <p-button
            [label]="marker() ? 'Update Marker' : 'Add Marker'"
            type="submit"
            [loading]="saving()"
            [disabled]="!canSubmit()"
          />
        }
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

  readonly precisionOptions = DATE_PRECISIONS.map((value) => ({
    value,
    label: DATE_PRECISION_LABELS[value],
  }));

  private readonly quarterOptions = [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, value: n }));
  private readonly monthOptions = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ].map((label, i) => ({ label, value: i + 1 }));
  private readonly halfOptions = [
    { label: 'H1 (Jan-Jun)', value: 1 },
    { label: 'H2 (Jul-Dec)', value: 2 },
  ];

  readonly extentOptions = [
    { label: 'Point (single date)', value: 'point' },
    { label: 'Until (ends on a date)', value: 'until' },
    { label: 'Onwards (ongoing, no end)', value: 'onwards' },
  ];

  // Form fields
  readonly categoryId = signal('');
  readonly markerTypeId = signal('');
  readonly title = signal('');
  readonly projection = signal<Projection>('actual');
  readonly eventDate = signal('');
  readonly datePrecision = signal<DatePrecision>('exact');
  readonly periodYear = signal<number>(new Date().getFullYear());
  readonly periodSub = signal<number>(1);
  readonly endDate = signal('');
  readonly extent = signal<'point' | 'until' | 'onwards'>('point');
  readonly endDatePrecision = signal<DatePrecision>('exact');
  readonly endPeriodYear = signal<number>(new Date().getFullYear());
  readonly endPeriodSub = signal<number>(1);
  readonly description = signal('');
  readonly sourceUrl = signal('');
  readonly regulatoryPathway = signal('');
  readonly selectedTrialId = signal<string>('');

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Sub-period options for the active precision (empty for exact/year). */
  readonly subOptions = computed(() => {
    switch (this.datePrecision()) {
      case 'quarter':
        return this.quarterOptions;
      case 'month':
        return this.monthOptions;
      case 'half':
        return this.halfOptions;
      default:
        return [];
    }
  });

  /**
   * The date actually stored in event_date: the user's exact date, or the
   * period midpoint for an approximate precision.
   */
  readonly effectiveEventDate = computed(() => {
    const precision = this.datePrecision();
    if (precision === 'exact') return this.eventDate();
    const year = this.periodYear();
    if (!year || year < 1900 || year > 2200) return '';
    return precisionMidpointISO(precision, year, this.periodSub());
  });

  /** Sub-period options for the END precision (empty for exact/year). */
  readonly endSubOptions = computed(() => {
    switch (this.endDatePrecision()) {
      case 'quarter':
        return this.quarterOptions;
      case 'month':
        return this.monthOptions;
      case 'half':
        return this.halfOptions;
      default:
        return [];
    }
  });

  readonly isOngoing = computed(() => this.extent() === 'onwards');

  /** The stored end_date: null unless a bounded ("until") extent is set. */
  readonly effectiveEndDate = computed(() => {
    if (this.extent() !== 'until') return '';
    const precision = this.endDatePrecision();
    if (precision === 'exact') return this.endDate();
    const year = this.endPeriodYear();
    if (!year || year < 1900 || year > 2200) return '';
    return precisionMidpointISO(precision, year, this.endPeriodSub());
  });

  /** A bounded end must resolve to a date strictly after the start. */
  readonly rangeValid = computed(() => {
    if (this.extent() !== 'until') return true;
    const end = this.effectiveEndDate();
    const start = this.effectiveEventDate();
    if (!end || !start) return true; // incompleteness handled by canSubmit
    return end > start;
  });

  readonly canSubmit = computed(
    () =>
      !!this.categoryId() &&
      !!this.markerTypeId() &&
      this.title().trim().length > 0 &&
      !!this.effectiveEventDate() &&
      !!this.selectedTrialId() &&
      (this.extent() !== 'until' || (!!this.effectiveEndDate() && this.rangeValid())),
  );

  onExtentChange(extent: 'point' | 'until' | 'onwards'): void {
    this.extent.set(extent);
  }

  onEndPrecisionChange(precision: DatePrecision): void {
    this.endDatePrecision.set(precision);
    this.endPeriodSub.set(1);
  }

  onPrecisionChange(precision: DatePrecision): void {
    this.datePrecision.set(precision);
    // The previous sub-index may be out of range for the new precision
    // (e.g. month 12 -> quarter), so reset to the first period.
    this.periodSub.set(1);
  }

  ngOnInit(): void {
    this.loadData();

    const existing = this.marker();
    if (existing) {
      this.markerTypeId.set(existing.marker_type_id);
      this.title.set(existing.title);
      this.projection.set(existing.projection);
      this.eventDate.set(existing.event_date);
      this.datePrecision.set(existing.date_precision ?? 'exact');
      if (isApproximate(existing.date_precision) && existing.event_date) {
        const { year, sub } = markerPeriodFromDate(
          existing.event_date,
          existing.date_precision,
        );
        this.periodYear.set(year);
        this.periodSub.set(sub);
      }
      this.endDate.set(existing.end_date ?? '');
      // Extent: ongoing > bounded end > point.
      if (existing.is_ongoing) {
        this.extent.set('onwards');
      } else if (existing.end_date) {
        this.extent.set('until');
        this.endDatePrecision.set(existing.end_date_precision ?? 'exact');
        if (isApproximate(existing.end_date_precision)) {
          const { year, sub } = markerPeriodFromDate(
            existing.end_date,
            existing.end_date_precision,
          );
          this.endPeriodYear.set(year);
          this.endPeriodSub.set(sub);
        }
      }
      this.description.set(existing.description ?? '');
      // Prefer the first attached citation; fall back to the legacy scalar
      // until S5 drops source_url. The single field maps back to one citation.
      this.sourceUrl.set(existing.sources?.[0]?.url ?? existing.source_url ?? '');
      this.regulatoryPathway.set(
        (existing.metadata as Record<string, string> | null)?.['pathway'] ?? '',
      );

      // Under the events model each marker has exactly one trial anchor.
      // Prefill it from the marker's own anchor; the route trial is the
      // fallback below. Read defensively: anchor_id rides through the Marker
      // shape via ...rest in mapEventToMarker but is not a declared field.
      const anchorId = (existing as unknown as { anchor_id?: string | null }).anchor_id;
      if (anchorId) {
        this.selectedTrialId.set(anchorId);
      }
    }

    // Pre-select trial from route context when no anchor was prefilled.
    const routeTrialId = this.trialId();
    if (routeTrialId && !this.selectedTrialId()) {
      this.selectedTrialId.set(routeTrialId);
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

  /**
   * True when the form is editing a ct.gov-owned marker. In this state all
   * editable controls (including the trial-assignment multiselect) and the
   * Save button are hidden/disabled: the DB BEFORE UPDATE trigger would reject
   * the write, and the a11y rule prohibits offering an action that will fail.
   * Create mode and analyst-owned markers are never locked.
   */
  protected readonly ctgovLocked = computed(() => isCtgovOwnedMarker(this.marker()));

  protected readonly showCtgovAutoMarkerHint = computed(() => {
    const typeId = this.markerTypeId();
    const selectedId = this.selectedTrialId();
    if (!typeId || !selectedId) return false;
    const selectedType = this.markerTypes().find((t) => t.id === typeId);
    if (!selectedType) return false;
    const autoTypeName =
      selectedType.name === 'Trial Start' ||
      selectedType.name === 'Primary Completion Date (PCD)' ||
      selectedType.name === 'Trial End';
    if (!autoTypeName) return false;
    const selectedTrial = this.trials().find((t) => t.id === selectedId);
    return !!selectedTrial?.identifier;
  });

  async onSubmit(): Promise<void> {
    if (this.ctgovLocked()) return;
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
      event_date: this.effectiveEventDate(),
      date_precision: this.datePrecision(),
      end_date: this.effectiveEndDate() || null,
      end_date_precision: this.extent() === 'until' ? this.endDatePrecision() : 'exact',
      is_ongoing: this.isOngoing(),
      description: this.description() || null,
      source_url: this.sourceUrl() || null,
      metadata,
    };

    try {
      const existing = this.marker();

      if (existing) {
        // Re-anchoring to a different trial on edit is deferred to Stage 3.
        await this.markerService.update(existing.id, payload);
      } else {
        await this.markerService.create(spaceId, payload, this.selectedTrialId());
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
