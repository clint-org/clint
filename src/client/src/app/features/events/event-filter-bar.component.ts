import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';
import { MultiSelect } from 'primeng/multiselect';
import { DatePicker } from 'primeng/datepicker';

import { EventsPageFilters, EntityLevel, EventPriority } from '../../core/models/event.model';

@Component({
  selector: 'app-event-filter-bar',
  standalone: true,
  imports: [FormsModule, Select, MultiSelect, DatePicker],
  template: `
    <div class="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div class="min-w-[140px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-date-from">From</label>
        <p-datepicker
          inputId="filter-date-from"
          [ngModel]="dateFromValue"
          (ngModelChange)="onDateFromChange($event)"
          dateFormat="yy-mm-dd"
          [showClear]="true"
          placeholder="Start date"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[140px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-date-to">To</label>
        <p-datepicker
          inputId="filter-date-to"
          [ngModel]="dateToValue"
          (ngModelChange)="onDateToChange($event)"
          dateFormat="yy-mm-dd"
          [showClear]="true"
          placeholder="End date"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[130px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-level">Level</label>
        <p-select
          inputId="filter-level"
          [options]="entityLevelOptions"
          [ngModel]="filters().entityLevel"
          (ngModelChange)="onEntityLevelChange($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="All levels"
          [showClear]="true"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[160px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-category">Category</label>
        <p-multiselect
          inputId="filter-category"
          [options]="categories()"
          [ngModel]="filters().categoryIds"
          (ngModelChange)="onCategoryChange($event)"
          optionLabel="name"
          optionValue="id"
          placeholder="All categories"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[140px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-tags">Tags</label>
        <p-multiselect
          inputId="filter-tags"
          [options]="tagOptions()"
          [ngModel]="filters().tags"
          (ngModelChange)="onTagsChange($event)"
          placeholder="All tags"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[110px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-priority">Priority</label>
        <p-select
          inputId="filter-priority"
          [options]="priorityOptions"
          [ngModel]="filters().priority"
          (ngModelChange)="onPriorityChange($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="All"
          [showClear]="true"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[110px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-source">Source</label>
        <p-select
          inputId="filter-source"
          [options]="sourceTypeOptions"
          [ngModel]="filters().sourceType"
          (ngModelChange)="onSourceTypeChange($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="All"
          [showClear]="true"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>
    </div>
  `,
})
export class EventFilterBarComponent {
  readonly filters = input.required<EventsPageFilters>();
  readonly categories = input.required<{ id: string; name: string; group: string }[]>();
  readonly tags = input.required<string[]>();

  readonly filtersChange = output<EventsPageFilters>();

  readonly entityLevelOptions: { label: string; value: EntityLevel }[] = [
    { label: 'Industry', value: 'space' },
    { label: 'Company', value: 'company' },
    { label: 'Product', value: 'product' },
    { label: 'Trial', value: 'trial' },
  ];

  readonly priorityOptions: { label: string; value: EventPriority }[] = [
    { label: 'High', value: 'high' },
    { label: 'Low', value: 'low' },
  ];

  readonly sourceTypeOptions = [
    { label: 'Events', value: 'event' },
    { label: 'Markers', value: 'marker' },
  ];

  get dateFromValue(): Date | null {
    const d = this.filters().dateFrom;
    return d ? new Date(d + 'T00:00:00') : null;
  }

  get dateToValue(): Date | null {
    const d = this.filters().dateTo;
    return d ? new Date(d + 'T00:00:00') : null;
  }

  tagOptions(): string[] {
    return this.tags();
  }

  onDateFromChange(date: Date | null): void {
    this.emit({ dateFrom: date ? this.formatDate(date) : null });
  }

  onDateToChange(date: Date | null): void {
    this.emit({ dateTo: date ? this.formatDate(date) : null });
  }

  onEntityLevelChange(level: EntityLevel | null): void {
    this.emit({ entityLevel: level, entityId: null });
  }

  onCategoryChange(ids: string[]): void {
    this.emit({ categoryIds: ids ?? [] });
  }

  onTagsChange(tags: string[]): void {
    this.emit({ tags: tags ?? [] });
  }

  onPriorityChange(priority: EventPriority | null): void {
    this.emit({ priority });
  }

  onSourceTypeChange(sourceType: 'event' | 'marker' | null): void {
    this.emit({ sourceType });
  }

  private emit(patch: Partial<EventsPageFilters>): void {
    this.filtersChange.emit({ ...this.filters(), ...patch });
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
