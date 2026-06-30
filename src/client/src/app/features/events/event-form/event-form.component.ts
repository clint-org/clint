import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { Select } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { Checkbox } from 'primeng/checkbox';
import { DatePicker } from 'primeng/datepicker';
import { AutoComplete } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';
import { EventService } from '../../../core/services/event.service';
import { EventDetailService } from '../../../core/services/event-detail.service';
import { IndicationService } from '../../../core/services/indication.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { CompanyService } from '../../../core/services/company.service';
import { AssetService } from '../../../core/services/asset.service';
import { TrialService } from '../../../core/services/trial.service';
import { toTrialOption } from '../../../core/utils/to-trial-option';
import { extractConstraintMessage } from '../../../core/util/db-error';
import type { MarkerType } from '../../../core/models/marker.model';
import type { Indication } from '../../../core/models/indication.model';
import { eventTypeLiftsStatus, shouldWarnMissingIndication } from './event-stage-lift';
import {
  buildCreateEventArgs,
  buildUpdateEventArgs,
  extentFromEndFields,
  isEventFormValid,
  PERIOD_SUBS,
  periodFromDate,
  PROJECTION_OPTIONS,
  resolvePeriodMidpoint,
  significanceChoiceFromValue,
  visibilityChoiceFromValue,
  type AnchorType,
  type DatePrecision,
  type EventFormState,
  type Extent,
  type Projection,
  type SignificanceChoice,
  type SourceRow,
  type VisibilityChoice,
} from './event-payload';

// DB column -> field label for constraint-violation messages (db-error util).
const EVENT_COLUMN_LABELS: Record<string, string> = {
  event_type_id: 'Event type',
  anchor_id: 'Anchor',
  title: 'Title',
  event_date: 'Date',
};

interface EntityOption {
  id: string;
  label: string;
  sublabel: string;
}
interface TypeGroup {
  label: string;
  value: string;
  items: { label: string; value: string }[];
}

function toIso(d: Date | null): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a stored `YYYY-MM-DD` into a local Date for the p-datepicker model. */
function fromIso(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

@Component({
  selector: 'app-event-form',
  imports: [
    FormsModule,
    InputText,
    Textarea,
    Select,
    SelectButton,
    Checkbox,
    DatePicker,
    AutoComplete,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4" aria-label="Event form">
      @if (ctgovLocked()) {
        <p-message severity="warn" [closable]="false">
          This event is managed by ClinicalTrials.gov and is read-only. Dates and status are kept in
          sync from the registry.
        </p-message>
      }
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <!-- Step 1: event type drives the rest -->
      <app-form-field label="Event type" fieldId="ev-type" [required]="true" spacing="pb-2">
        <p-select
          inputId="ev-type"
          [options]="typeGroups()"
          [ngModel]="eventTypeId()"
          (ngModelChange)="eventTypeId.set($event)"
          name="eventTypeId"
          [group]="true"
          optionLabel="label"
          optionValue="value"
          optionGroupLabel="label"
          optionGroupChildren="items"
          [filter]="true"
          placeholder="Select an event type to start"
          styleClass="w-full"
          appendTo="body"
          [disabled]="ctgovLocked()"
        />
        @if (selectedType(); as t) {
          <p class="mt-2 text-[11px] text-slate-500">
            {{ categoryName(t.category_id) }} - default significance
            <span class="font-medium">{{ t.default_significance ?? 'low' }}</span>
          </p>
        }
      </app-form-field>

      @if (eventTypeId()) {
        <!-- Core -->
        <app-form-field label="Title" fieldId="ev-title" [required]="true" spacing="">
          <input
            pInputText
            id="ev-title"
            class="w-full"
            [ngModel]="title()"
            (ngModelChange)="title.set($event)"
            name="title"
            required
            aria-required="true"
            [disabled]="ctgovLocked()"
          />
        </app-form-field>

        <!-- Anchor: read-only summary with override when pre-filled, else selects -->
        @if (anchorPrefilled() && !anchorOverride()) {
          <app-form-field label="Anchor" fieldId="ev-anchor-summary" spacing="">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm text-slate-800">{{ anchorSummary() }}</span>
              @if (!ctgovLocked()) {
                <p-button
                  label="Change anchor"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="anchorOverride.set(true)"
                  type="button"
                />
              }
            </div>
          </app-form-field>
        } @else {
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <app-form-field label="Level" fieldId="ev-level" spacing="">
              <p-select
                inputId="ev-level"
                [options]="levelOptions()"
                [ngModel]="anchorType()"
                (ngModelChange)="onLevelChange($event)"
                name="anchorType"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full"
                [disabled]="ctgovLocked()"
              />
            </app-form-field>
            @if (anchorType() !== 'space') {
              <app-form-field [label]="entityLabel()" fieldId="ev-entity" [required]="true" spacing="">
                <p-select
                  inputId="ev-entity"
                  [options]="entityOptions()"
                  [ngModel]="anchorId()"
                  (ngModelChange)="anchorId.set($event)"
                  name="anchorId"
                  optionLabel="label"
                  optionValue="id"
                  [filter]="true"
                  filterBy="label,sublabel"
                  placeholder="Select"
                  styleClass="w-full"
                  appendTo="body"
                  [disabled]="ctgovLocked()"
                />
              </app-form-field>
            }
          </div>
        }

        <!-- Indication attribution: meaningful for asset-anchored events; required
             in practice for Approval/Launch since it is what lifts the asset stage. -->
        @if (anchorType() === 'asset') {
          <app-form-field
            [label]="liftsStatus() ? 'Indication (lifts stage)' : 'Indication'"
            fieldId="ev-indication"
            spacing=""
          >
            <p-select
              inputId="ev-indication"
              [options]="indicationOptions()"
              [ngModel]="indicationId()"
              (ngModelChange)="indicationId.set($event ?? null)"
              name="indicationId"
              optionLabel="label"
              optionValue="value"
              [filter]="true"
              [showClear]="true"
              placeholder="Attribute to an indication (optional)"
              styleClass="w-full"
              appendTo="body"
              [disabled]="ctgovLocked()"
            />
            @if (showIndicationHint()) {
              <p class="mt-1 text-[11px] text-amber-700">
                Select an indication, or this approval won't update the asset's stage (it stays at
                its trial phase).
              </p>
            }
          </app-form-field>
        }

        <!-- Date + precision -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <app-form-field label="Date precision" fieldId="ev-precision" spacing="">
            <p-select
              inputId="ev-precision"
              [options]="precisionOptions"
              [ngModel]="datePrecision()"
              (ngModelChange)="datePrecision.set($event)"
              name="datePrecision"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
              [disabled]="ctgovLocked()"
            />
          </app-form-field>
          @if (datePrecision() === 'exact') {
            <app-form-field label="Date" fieldId="ev-date" [required]="true" spacing="">
              <p-datepicker
                inputId="ev-date"
                [ngModel]="eventDate()"
                (ngModelChange)="eventDate.set($event)"
                name="eventDate"
                dateFormat="yy-mm-dd"
                styleClass="w-full"
                [showIcon]="true"
                appendTo="body"
                [disabled]="ctgovLocked()"
              />
            </app-form-field>
          } @else {
            <app-form-field label="Period" fieldId="ev-period-year" [required]="true" spacing="">
              <div class="flex gap-2">
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
                  pInputText
                  id="ev-period-year"
                  type="number"
                  class="w-28"
                  [ngModel]="periodYear()"
                  (ngModelChange)="periodYear.set(+$event)"
                  name="periodYear"
                  min="2000"
                  max="2100"
                  aria-label="Year"
                  [disabled]="ctgovLocked()"
                />
              </div>
              <p class="mt-1 text-[11px] text-slate-500">
                Approximate ({{ datePrecision() }}); placed at the period midpoint
                ({{ effectiveEventDate() }}).
              </p>
            </app-form-field>
          }
        </div>

        <!-- Extent + end precision -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <app-form-field label="Extent" fieldId="ev-extent" spacing="">
            <p-select
              inputId="ev-extent"
              [options]="extentOptions"
              [ngModel]="extent()"
              (ngModelChange)="extent.set($event)"
              name="extent"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
              [disabled]="ctgovLocked()"
            />
          </app-form-field>
          @if (extent() === 'until') {
            <app-form-field label="End precision" fieldId="ev-end-precision" spacing="">
              <p-select
                inputId="ev-end-precision"
                [options]="precisionOptions"
                [ngModel]="endDatePrecision()"
                (ngModelChange)="endDatePrecision.set($event)"
                name="endDatePrecision"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full"
                [disabled]="ctgovLocked()"
              />
            </app-form-field>
          }
        </div>

        <!-- End date / period -->
        @if (extent() === 'until') {
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            @if (endDatePrecision() === 'exact') {
              <app-form-field label="Ends" fieldId="ev-end" [required]="true" spacing="">
                <p-datepicker
                  inputId="ev-end"
                  [ngModel]="endDate()"
                  (ngModelChange)="endDate.set($event)"
                  name="endDate"
                  dateFormat="yy-mm-dd"
                  styleClass="w-full"
                  [showIcon]="true"
                  appendTo="body"
                  [disabled]="ctgovLocked()"
                />
                @if (!rangeValid()) {
                  <p class="mt-1 text-[11px] text-red-700">End must be on or after the start.</p>
                }
              </app-form-field>
            } @else {
              <app-form-field label="End period" fieldId="ev-end-period-year" [required]="true" spacing="">
                <div class="flex gap-2">
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
                    pInputText
                    id="ev-end-period-year"
                    type="number"
                    class="w-28"
                    [ngModel]="endPeriodYear()"
                    (ngModelChange)="endPeriodYear.set(+$event)"
                    name="endPeriodYear"
                    min="2000"
                    max="2100"
                    aria-label="End year"
                    [disabled]="ctgovLocked()"
                  />
                </div>
                <p class="mt-1 text-[11px] text-slate-500">
                  Approximate ({{ endDatePrecision() }}); placed at the period midpoint
                  ({{ effectiveEndDate() }}).
                </p>
                @if (!rangeValid()) {
                  <p class="mt-1 text-[11px] text-red-700">End must be on or after the start.</p>
                }
              </app-form-field>
            }
          </div>
        }

        @if (showRegulatoryPathway()) {
          <app-form-field label="Regulatory pathway" fieldId="ev-pathway" spacing="">
            <p-select
              inputId="ev-pathway"
              [options]="pathwayOptions"
              [ngModel]="regulatoryPathway()"
              (ngModelChange)="regulatoryPathway.set($event)"
              name="regulatoryPathway"
              optionLabel="label"
              optionValue="value"
              placeholder="Select pathway"
              styleClass="w-full"
              [disabled]="ctgovLocked()"
            />
          </app-form-field>
        }

        <!-- Sources -->
        <app-form-field label="Sources" fieldId="ev-sources" spacing="">
          @for (row of sources(); track $index) {
            <div class="mb-2 flex items-center gap-2">
              <input
                pInputText
                class="flex-1"
                [ngModel]="row.url"
                (ngModelChange)="setSourceUrl($index, $event)"
                [name]="'srcUrl' + $index"
                placeholder="https://..."
                type="url"
                [attr.aria-label]="'Source URL ' + ($index + 1)"
                [disabled]="ctgovLocked()"
              />
              <input
                pInputText
                class="w-40"
                [ngModel]="row.label"
                (ngModelChange)="setSourceLabel($index, $event)"
                [name]="'srcLabel' + $index"
                placeholder="Label (optional)"
                [attr.aria-label]="'Source label ' + ($index + 1)"
                [disabled]="ctgovLocked()"
              />
              <p-button
                icon="pi pi-times"
                severity="secondary"
                [text]="true"
                [attr.aria-label]="'Remove source ' + ($index + 1)"
                (onClick)="removeSource($index)"
                type="button"
                [disabled]="ctgovLocked()"
              />
            </div>
          }
          @if (!ctgovLocked()) {
            <p-button
              label="Add source"
              icon="pi pi-plus"
              severity="secondary"
              [outlined]="true"
              size="small"
              (onClick)="addSource()"
              type="button"
            />
          }
          @if (registryUrl(); as reg) {
            <div class="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              Registry (derived, read-only):
              <a [href]="reg" target="_blank" rel="noopener" class="font-mono text-brand-700 underline">{{ reg }}</a>
            </div>
          }
        </app-form-field>

        <!-- Description -->
        <app-form-field label="Description" fieldId="ev-desc" spacing="">
          <textarea
            pTextarea
            id="ev-desc"
            class="w-full"
            [ngModel]="description()"
            (ngModelChange)="description.set($event)"
            name="description"
            rows="3"
            [disabled]="ctgovLocked()"
          ></textarea>
        </app-form-field>

        <!-- Tags -->
        <app-form-field label="Tags" fieldId="ev-tags" spacing="">
          <p-auto-complete
            inputId="ev-tags"
            [ngModel]="tags()"
            (ngModelChange)="tags.set($event ?? [])"
            name="tags"
            [multiple]="true"
            [typeahead]="false"
            placeholder="Add tags..."
            styleClass="w-full"
            [disabled]="ctgovLocked()"
          />
        </app-form-field>

        <!-- Advanced (overrides + qualifiers) -->
        <div class="border-t border-slate-100 pt-2">
          <button
            type="button"
            class="text-xs font-medium text-brand-700"
            [attr.aria-expanded]="showAdvanced()"
            (click)="showAdvanced.set(!showAdvanced())"
          >
            {{ showAdvanced() ? 'Hide' : 'Show' }} advanced (provenance, significance, visibility)
          </button>
        </div>
        @if (showAdvanced()) {
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <app-form-field label="Provenance" fieldId="ev-projection" spacing="">
              <p-select
                inputId="ev-projection"
                [options]="projectionOptions"
                [ngModel]="projection()"
                (ngModelChange)="projection.set($event)"
                name="projection"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full"
                [disabled]="ctgovLocked()"
              />
            </app-form-field>
            <app-form-field label="Significance" fieldId="ev-sig" spacing="">
              <p-selectButton
                [options]="significanceChoices"
                [ngModel]="significance()"
                (ngModelChange)="significance.set($event)"
                name="significance"
                [allowEmpty]="false"
                ariaLabelledBy="ev-sig"
                [disabled]="ctgovLocked()"
              />
            </app-form-field>
            <app-form-field label="Timeline visibility" fieldId="ev-vis" spacing="">
              <p-selectButton
                [options]="visibilityChoices"
                [ngModel]="visibility()"
                (ngModelChange)="visibility.set($event)"
                name="visibility"
                [allowEmpty]="false"
                ariaLabelledBy="ev-vis"
                [disabled]="ctgovLocked()"
              />
            </app-form-field>
            <app-form-field label="Status" fieldId="ev-nle" spacing="">
              <div class="flex items-center gap-2">
                <p-checkbox
                  inputId="ev-nle"
                  [binary]="true"
                  [ngModel]="noLongerExpected()"
                  (ngModelChange)="noLongerExpected.set($event)"
                  name="noLongerExpected"
                  [disabled]="ctgovLocked()"
                />
                <label for="ev-nle" class="text-sm text-slate-700">No longer expected</label>
              </div>
            </app-form-field>
          </div>
        }
      }

      <app-form-actions
        [submitLabel]="mode() === 'edit' ? 'Update event' : 'Log event'"
        [loading]="saving()"
        [disabled]="!canSubmit()"
        (cancelled)="cancelled.emit()"
      />
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFormComponent implements OnInit {
  readonly spaceId = input.required<string>();
  readonly mode = input<'create' | 'edit'>('create');
  readonly eventId = input<string | null>(null);
  readonly presetAnchorType = input<AnchorType>('trial');
  readonly presetAnchorId = input<string | null>(null);
  readonly ctgovLocked = input(false);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private eventService = inject(EventService);
  private catalystService = inject(EventDetailService);
  private typeService = inject(MarkerTypeService);
  private categoryService = inject(MarkerCategoryService);
  private companyService = inject(CompanyService);
  private assetService = inject(AssetService);
  private trialService = inject(TrialService);
  private indicationService = inject(IndicationService);
  private supabase = inject(SupabaseService);

  // Space-anchored ("Industry") events render on no timeline, only in the Events
  // feed, so the create/edit form does not offer that scope. The `space` anchor
  // type stays valid server-side; an event already anchored to it just shows a
  // blank scope select here (none exist today).
  private readonly allLevelOptions = [
    { label: 'Company', value: 'company' as AnchorType },
    { label: 'Asset', value: 'asset' as AnchorType },
    { label: 'Trial', value: 'trial' as AnchorType },
  ];
  protected readonly projectionOptions = PROJECTION_OPTIONS;
  protected readonly precisionOptions: { label: string; value: DatePrecision }[] = [
    { label: 'Exact day', value: 'exact' },
    { label: 'Month', value: 'month' },
    { label: 'Quarter', value: 'quarter' },
    { label: 'Half', value: 'half' },
    { label: 'Year', value: 'year' },
  ];
  protected readonly extentOptions: { label: string; value: Extent }[] = [
    { label: 'Point in time', value: 'point' },
    { label: 'Bounded end', value: 'until' },
    { label: 'Ongoing (onwards)', value: 'onwards' },
  ];
  protected readonly significanceChoices: SignificanceChoice[] = ['Default', 'High', 'Low'];
  protected readonly visibilityChoices: VisibilityChoice[] = ['Default', 'Pinned', 'Hidden'];
  // Carried from the marker form: shown only for the FDA Submission event type (metadata.pathway).
  protected readonly pathwayOptions = ['BLA', 'NDA', 'sNDA', 'sBLA', '505(b)(2)', 'Biosimilar'].map(
    (p) => ({ label: p, value: p }),
  );

  private readonly types = signal<MarkerType[]>([]);
  private readonly categories = signal<{ id: string; name: string; display_order: number }[]>([]);
  private readonly companies = signal<EntityOption[]>([]);
  private readonly assets = signal<EntityOption[]>([]);
  private readonly trials = signal<EntityOption[]>([]);
  private readonly indications = signal<Indication[]>([]);

  protected readonly eventTypeId = signal<string | null>(null);
  protected readonly anchorType = linkedSignal(() => this.presetAnchorType());
  protected readonly anchorId = linkedSignal(() => this.presetAnchorId());
  protected readonly anchorOverride = signal(false);
  protected readonly indicationId = signal<string | null>(null);
  protected readonly title = signal('');
  protected readonly eventDate = signal<Date | null>(null);
  protected readonly datePrecision = signal<DatePrecision>('exact');
  protected readonly periodYear = signal(new Date().getFullYear());
  protected readonly periodSub = signal(0);
  protected readonly extent = signal<Extent>('point');
  protected readonly endDate = signal<Date | null>(null);
  protected readonly endDatePrecision = signal<DatePrecision>('exact');
  protected readonly endPeriodYear = signal(new Date().getFullYear());
  protected readonly endPeriodSub = signal(0);
  protected readonly projection = signal<Projection>('actual');
  protected readonly significance = signal<SignificanceChoice>('Default');
  protected readonly visibility = signal<VisibilityChoice>('Default');
  protected readonly noLongerExpected = signal(false);
  protected readonly description = signal('');
  protected readonly sources = signal<SourceRow[]>([]);
  protected readonly tags = signal<string[]>([]);
  // metadata.pathway; shown only for the FDA Submission event type (marker-form parity).
  protected readonly regulatoryPathway = signal<string | null>(null);
  protected readonly showAdvanced = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selectedType = computed(() =>
    this.types().find((t) => t.id === this.eventTypeId()) ?? null,
  );
  protected readonly showRegulatoryPathway = computed(() => this.selectedType()?.name === 'FDA Submission');

  // True for the Approval / Launch system types, whose actual, indication-tagged
  // events lift asset_indications.development_status to APPROVED / LAUNCHED.
  protected readonly liftsStatus = computed(() => eventTypeLiftsStatus(this.selectedType()));

  // Status-lifting events are an asset-level concept, so constrain the anchor
  // level to Asset (no Company / Trial / Space) when such a type is chosen.
  protected readonly levelOptions = computed(() =>
    this.liftsStatus()
      ? this.allLevelOptions.filter((o) => o.value === 'asset')
      : this.allLevelOptions,
  );

  protected readonly indicationOptions = computed(() =>
    this.indications().map((i) => ({
      label: i.abbreviation ? `${i.name} (${i.abbreviation})` : i.name,
      value: i.id,
    })),
  );

  // Soft hint (never blocks save): a lifting type with no indication mapped.
  protected readonly showIndicationHint = computed(() =>
    shouldWarnMissingIndication({ lifts: this.liftsStatus(), indicationId: this.indicationId() }),
  );

  // Keep the anchor on 'asset' whenever a status-lifting type is selected. A
  // type switch from e.g. a trial-anchored readout to Approval re-points the
  // anchor and clears the now-invalid entity selection.
  private readonly enforceAssetAnchor = effect(() => {
    if (this.liftsStatus() && this.anchorType() !== 'asset') {
      this.anchorType.set('asset');
      this.anchorId.set(null);
    }
  });
  protected readonly typeGroups = computed<TypeGroup[]>(() =>
    this.categories()
      .map((c) => ({
        label: c.name,
        value: c.id,
        items: this.types()
          .filter((t) => t.category_id === c.id)
          .map((t) => ({ label: t.name, value: t.id })),
      }))
      .filter((g) => g.items.length > 0),
  );
  protected readonly entityLabel = computed(() =>
    this.anchorType() === 'company' ? 'Company' : this.anchorType() === 'asset' ? 'Asset' : 'Trial',
  );
  protected readonly entityOptions = computed<EntityOption[]>(() => {
    if (this.anchorType() === 'company') return this.companies();
    if (this.anchorType() === 'asset') return this.assets();
    if (this.anchorType() === 'trial') return this.trials();
    return [];
  });
  protected readonly selectedEntity = computed(() =>
    this.entityOptions().find((e) => e.id === this.anchorId()) ?? null,
  );
  protected readonly anchorPrefilled = computed(
    () =>
      !!this.presetAnchorId() &&
      this.mode() === 'create' &&
      // A lifting type forces an asset anchor; if the preset was something else,
      // fall through to the full selects rather than show a stale summary.
      !(this.liftsStatus() && this.presetAnchorType() !== 'asset'),
  );
  protected readonly anchorSummary = computed(() => {
    if (this.anchorType() === 'space') return 'Space';
    const e = this.selectedEntity();
    return e ? `${this.entityLabel()}: ${e.label}` : this.entityLabel();
  });
  protected readonly registryUrl = computed(() => {
    if (this.anchorType() !== 'trial') return null;
    const t = this.trials().find((e) => e.id === this.anchorId());
    const nct = t?.sublabel.match(/NCT\d+/)?.[0];
    return nct ? `https://clinicaltrials.gov/study/${nct}` : null;
  });
  protected readonly subOptions = computed(() => {
    const p = this.datePrecision();
    if (p === 'month' || p === 'quarter' || p === 'half') return PERIOD_SUBS[p];
    return [];
  });
  protected readonly endSubOptions = computed(() => {
    const p = this.endDatePrecision();
    if (p === 'month' || p === 'quarter' || p === 'half') return PERIOD_SUBS[p];
    return [];
  });
  protected readonly effectiveEventDate = computed(() =>
    resolvePeriodMidpoint(this.datePrecision(), this.periodYear(), this.periodSub(), toIso(this.eventDate())),
  );
  protected readonly effectiveEndDate = computed(() =>
    resolvePeriodMidpoint(this.endDatePrecision(), this.endPeriodYear(), this.endPeriodSub(), toIso(this.endDate())),
  );
  protected readonly rangeValid = computed(() => {
    if (this.extent() !== 'until') return true;
    const end = this.effectiveEndDate();
    return !!end && end >= this.effectiveEventDate();
  });

  private state(): EventFormState {
    return {
      eventTypeId: this.eventTypeId(),
      anchorType: this.anchorType(),
      anchorId: this.anchorId(),
      title: this.title(),
      eventDate: this.effectiveEventDate(),
      datePrecision: this.datePrecision(),
      extent: this.extent(),
      endDate: this.extent() === 'until' ? this.effectiveEndDate() : null,
      endDatePrecision: this.endDatePrecision(),
      projection: this.projection(),
      significance: this.significance(),
      visibility: this.visibility(),
      noLongerExpected: this.noLongerExpected(),
      description: this.description(),
      sources: this.sources(),
      tags: this.tags(),
      regulatoryPathway: this.showRegulatoryPathway() ? this.regulatoryPathway() : null,
      // Indication attribution is only meaningful for asset-anchored events.
      indicationId: this.anchorType() === 'asset' ? this.indicationId() : null,
    };
  }

  protected readonly canSubmit = computed(() => !this.ctgovLocked() && isEventFormValid(this.state()));

  async ngOnInit(): Promise<void> {
    const sid = this.spaceId();
    const [types, cats, companies, assets, trials, indications] = await Promise.all([
      this.typeService.list(sid),
      this.categoryService.list(sid),
      this.companyService.list(sid),
      this.assetService.list(sid),
      this.trialService.listBySpace(sid),
      this.indicationService.list(sid),
    ]);
    this.types.set(types);
    this.indications.set(indications);
    this.categories.set(
      cats
        .map((c) => ({ id: c.id, name: c.name, display_order: c.display_order }))
        .sort((a, b) => a.display_order - b.display_order),
    );
    this.companies.set(companies.map((c) => ({ id: c.id, label: c.name, sublabel: '' })));
    this.assets.set(assets.map((a) => ({ id: a.id, label: a.name, sublabel: '' })));
    this.trials.set(
      trials.map((t) => {
        const opt = toTrialOption(t);
        return { id: opt.id, label: opt.label, sublabel: opt.identifier };
      }),
    );

    if (this.mode() === 'edit' && this.eventId()) {
      await this.hydrateForEdit(this.eventId()!);
    }
  }

  /**
   * Load an existing event into the form for editing. Reads the unified
   * get_event_detail wrapper (via EventDetailService) and reverses each write
   * mapping back into the form signals. Entities are already loaded above so the
   * anchor select renders the resolved name.
   */
  private async hydrateForEdit(eventId: string): Promise<void> {
    try {
      const { catalyst: c } = await this.catalystService.getCatalystDetail(eventId);
      this.eventTypeId.set(c.event_type_id);
      this.anchorType.set(c.anchor_type);
      this.anchorId.set(c.anchor_id);
      this.title.set(c.title);
      this.description.set(c.description ?? '');

      this.datePrecision.set(c.date_precision);
      if (c.date_precision === 'exact') {
        this.eventDate.set(fromIso(c.event_date));
      } else {
        const { year, sub } = periodFromDate(c.date_precision, c.event_date);
        this.periodYear.set(year);
        this.periodSub.set(sub);
      }

      const extent = extentFromEndFields(c.end_date, c.is_ongoing);
      this.extent.set(extent);
      if (extent === 'until') {
        this.endDatePrecision.set(c.end_date_precision);
        if (c.end_date_precision === 'exact') {
          this.endDate.set(fromIso(c.end_date));
        } else {
          const { year, sub } = periodFromDate(c.end_date_precision, c.end_date ?? '');
          this.endPeriodYear.set(year);
          this.endPeriodSub.set(sub);
        }
      }

      this.projection.set(c.projection as Projection);
      this.significance.set(significanceChoiceFromValue(c.significance));
      this.visibility.set(visibilityChoiceFromValue(c.visibility));
      this.noLongerExpected.set(c.no_longer_expected);

      const meta = c.metadata ?? {};
      this.tags.set(Array.isArray(meta['tags']) ? (meta['tags'] as string[]) : []);
      this.regulatoryPathway.set(typeof meta['pathway'] === 'string' ? (meta['pathway'] as string) : null);

      this.sources.set((c.sources ?? []).map((s) => ({ url: s.url, label: s.label ?? '' })));

      // EventDetail does not carry indication_id; read it directly so the picker
      // prefills and a save does not silently clear the existing attribution.
      const { data: indRow } = await this.supabase.client
        .from('events')
        .select('indication_id')
        .eq('id', eventId)
        .maybeSingle();
      this.indicationId.set((indRow?.['indication_id'] as string | null) ?? null);
    } catch (err) {
      this.error.set(extractConstraintMessage(err, EVENT_COLUMN_LABELS) ?? 'Could not load the event to edit.');
    }
  }

  protected categoryName(id: string): string {
    return this.categories().find((c) => c.id === id)?.name ?? '';
  }

  protected onLevelChange(level: AnchorType): void {
    this.anchorType.set(level);
    this.anchorId.set(null);
  }

  protected addSource(): void {
    this.sources.update((rows) => [...rows, { url: '', label: '' }]);
  }
  protected removeSource(i: number): void {
    this.sources.update((rows) => rows.filter((_, idx) => idx !== i));
  }
  protected setSourceUrl(i: number, url: string): void {
    this.sources.update((rows) => rows.map((r, idx) => (idx === i ? { ...r, url } : r)));
  }
  protected setSourceLabel(i: number, label: string): void {
    this.sources.update((rows) => rows.map((r, idx) => (idx === i ? { ...r, label } : r)));
  }

  protected async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const sid = this.spaceId();
      const sources = this.sources()
        .filter((s) => s.url.trim())
        .map((s) => ({ url: s.url.trim(), label: s.label.trim() }));
      const editId = this.eventId();
      if (this.mode() === 'edit' && editId) {
        await this.eventService.updateEvent(sid, editId, buildUpdateEventArgs(this.state()));
        if (sources.length || this.mode() === 'edit') {
          await this.eventService.updateSources(editId, sources);
        }
      } else {
        await this.eventService.createEvent(sid, buildCreateEventArgs(this.state()));
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(extractConstraintMessage(err, EVENT_COLUMN_LABELS) ?? 'Could not save the event.');
    } finally {
      this.saving.set(false);
    }
  }
}
