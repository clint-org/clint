import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { Chips } from 'primeng/chips';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import {
  AppEvent,
  EventCategory,
  EventPriority,
  EntityLevel,
  EventThread,
} from '../../core/models/event.model';
import { Company } from '../../core/models/company.model';
import { Product } from '../../core/models/product.model';
import { Trial } from '../../core/models/trial.model';
import { EventService } from '../../core/services/event.service';
import { EventCategoryService } from '../../core/services/event-category.service';
import { EventThreadService } from '../../core/services/event-thread.service';
import { CompanyService } from '../../core/services/company.service';
import { ProductService } from '../../core/services/product.service';
import { TrialService } from '../../core/services/trial.service';

interface SourceRow {
  url: string;
  label: string;
}

@Component({
  selector: 'app-event-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    Textarea,
    Select,
    DatePicker,
    Chips,
    ButtonModule,
    MessageModule,
  ],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4" aria-label="Event form">
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <!-- Entity level + entity picker -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="event-level" class="mb-1 block text-xs font-medium text-slate-600"
            >Level</label
          >
          <p-select
            inputId="event-level"
            [options]="entityLevelOptions"
            [(ngModel)]="entityLevel"
            name="entityLevel"
            optionLabel="label"
            optionValue="value"
            placeholder="Select level"
            [style]="{ width: '100%' }"
            (ngModelChange)="onEntityLevelChange()"
          />
        </div>

        @if (entityLevel && entityLevel !== 'space') {
          <div>
            <label for="event-entity" class="mb-1 block text-xs font-medium text-slate-600">
              {{
                entityLevel === 'company'
                  ? 'Company'
                  : entityLevel === 'product'
                    ? 'Product'
                    : 'Trial'
              }}
            </label>
            <p-select
              inputId="event-entity"
              [options]="entityOptions()"
              [(ngModel)]="entityId"
              name="entityId"
              optionLabel="name"
              optionValue="id"
              placeholder="Select..."
              [filter]="true"
              [style]="{ width: '100%' }"
            />
          </div>
        }
      </div>

      <!-- Title + Date -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="event-title" class="mb-1 block text-xs font-medium text-slate-600"
            >Title</label
          >
          <input
            pInputText
            id="event-title"
            [(ngModel)]="title"
            name="title"
            class="w-full"
            required
          />
        </div>
        <div>
          <label for="event-date" class="mb-1 block text-xs font-medium text-slate-600">Date</label>
          <p-datepicker
            inputId="event-date"
            [(ngModel)]="eventDateValue"
            name="eventDate"
            dateFormat="yy-mm-dd"
            [style]="{ width: '100%' }"
            appendTo="body"
          />
        </div>
      </div>

      <!-- Category + Priority -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="event-category" class="mb-1 block text-xs font-medium text-slate-600"
            >Category</label
          >
          <p-select
            inputId="event-category"
            [options]="categories()"
            [(ngModel)]="categoryId"
            name="categoryId"
            optionLabel="name"
            optionValue="id"
            placeholder="Select category"
            [style]="{ width: '100%' }"
          />
        </div>
        <div>
          <label for="event-priority" class="mb-1 block text-xs font-medium text-slate-600"
            >Priority</label
          >
          <p-select
            inputId="event-priority"
            [options]="priorityOptions"
            [(ngModel)]="priority"
            name="priority"
            optionLabel="label"
            optionValue="value"
            [style]="{ width: '100%' }"
          />
        </div>
      </div>

      <!-- Description -->
      <div>
        <label for="event-description" class="mb-1 block text-xs font-medium text-slate-600"
          >Description</label
        >
        <textarea
          pTextarea
          id="event-description"
          [(ngModel)]="description"
          name="description"
          rows="3"
          class="w-full"
        ></textarea>
      </div>

      <!-- Tags -->
      <div>
        <label for="event-tags" class="mb-1 block text-xs font-medium text-slate-600">Tags</label>
        <p-chips
          inputId="event-tags"
          [(ngModel)]="tags"
          name="tags"
          placeholder="Add tags..."
          [style]="{ width: '100%' }"
        />
      </div>

      <!-- Sources -->
      <div>
        <p class="mb-1 text-xs font-medium text-slate-600" id="source-urls-label">Source URLs</p>
        @for (src of sources; track $index) {
          <div class="mb-2 flex items-center gap-2">
            <input
              pInputText
              [(ngModel)]="src.url"
              [name]="'srcUrl' + $index"
              placeholder="URL"
              class="flex-1"
            />
            <input
              pInputText
              [(ngModel)]="src.label"
              [name]="'srcLabel' + $index"
              placeholder="Label (optional)"
              class="w-40"
            />
            <button
              type="button"
              class="text-slate-400 hover:text-red-500"
              (click)="removeSource($index)"
              aria-label="Remove source"
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        }
        <button
          type="button"
          class="text-xs text-brand-700 hover:text-brand-800"
          (click)="addSource()"
        >
          + Add source
        </button>
      </div>

      <!-- Thread -->
      <div>
        <label for="event-thread" class="mb-1 block text-xs font-medium text-slate-600"
          >Thread (optional)</label
        >
        <div class="flex items-center gap-2">
          <p-select
            inputId="event-thread"
            [options]="threads()"
            [(ngModel)]="threadId"
            name="threadId"
            optionLabel="title"
            optionValue="id"
            placeholder="None"
            [showClear]="true"
            [style]="{ width: '100%' }"
          />
        </div>
        @if (!threadId) {
          <div class="mt-2 flex items-center gap-2">
            <input
              pInputText
              [(ngModel)]="newThreadTitle"
              name="newThreadTitle"
              placeholder="Or start a new thread..."
              class="flex-1 text-sm"
            />
          </div>
        }
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2 pt-2">
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="cancelled.emit()"
          type="button"
        />
        <p-button [label]="eventId() ? 'Update' : 'Create'" type="submit" [loading]="saving()" />
      </div>
    </form>
  `,
})
export class EventFormComponent implements OnInit {
  readonly eventId = input<string | null>(null);

  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private eventService = inject(EventService);
  private eventCategoryService = inject(EventCategoryService);
  private eventThreadService = inject(EventThreadService);
  private companyService = inject(CompanyService);
  private productService = inject(ProductService);
  private trialService = inject(TrialService);
  private route = inject(ActivatedRoute);

  readonly entityLevelOptions: { label: string; value: EntityLevel }[] = [
    { label: 'Industry (space-wide)', value: 'space' },
    { label: 'Company', value: 'company' },
    { label: 'Product', value: 'product' },
    { label: 'Trial', value: 'trial' },
  ];

  readonly priorityOptions: { label: string; value: EventPriority }[] = [
    { label: 'Low', value: 'low' },
    { label: 'High', value: 'high' },
  ];

  categories = signal<EventCategory[]>([]);
  threads = signal<EventThread[]>([]);
  companies = signal<Company[]>([]);
  products = signal<Product[]>([]);
  trials = signal<Trial[]>([]);
  entityOptions = signal<{ id: string; name: string }[]>([]);

  // Form fields
  entityLevel: EntityLevel = 'space';
  entityId = '';
  title = '';
  eventDateValue: Date | null = null;
  categoryId = '';
  priority: EventPriority = 'low';
  description = '';
  tags: string[] = [];
  sources: SourceRow[] = [];
  threadId: string | null = null;
  newThreadTitle = '';
  linkedEventIds: string[] = [];

  saving = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const spaceId = this.getSpaceId();
    await this.loadData(spaceId);

    const id = this.eventId();
    if (id) {
      await this.loadExisting(id);
    }
  }

  onEntityLevelChange(): void {
    this.entityId = '';
    if (this.entityLevel === 'company') {
      this.entityOptions.set(this.companies().map((c) => ({ id: c.id, name: c.name })));
    } else if (this.entityLevel === 'product') {
      this.entityOptions.set(this.products().map((p) => ({ id: p.id, name: p.name })));
    } else if (this.entityLevel === 'trial') {
      this.entityOptions.set(this.trials().map((t) => ({ id: t.id, name: t.name })));
    } else {
      this.entityOptions.set([]);
    }
  }

  addSource(): void {
    this.sources = [...this.sources, { url: '', label: '' }];
  }

  removeSource(index: number): void {
    this.sources = this.sources.filter((_, i) => i !== index);
  }

  async onSubmit(): Promise<void> {
    if (!this.title || !this.eventDateValue || !this.categoryId) return;

    this.saving.set(true);
    this.error.set(null);

    const spaceId = this.getSpaceId();

    // Resolve thread
    let resolvedThreadId = this.threadId;
    if (!resolvedThreadId && this.newThreadTitle.trim()) {
      try {
        const thread = await this.eventThreadService.create(spaceId, this.newThreadTitle.trim());
        resolvedThreadId = thread.id;
      } catch (err) {
        this.error.set(err instanceof Error ? err.message : 'Could not create thread.');
        this.saving.set(false);
        return;
      }
    }

    // Compute thread_order if joining a thread
    let threadOrder: number | null = null;
    if (resolvedThreadId) {
      // Put at end -- monotonically increasing timestamp for ordering
      threadOrder = Date.now();
    }

    const eventDate = this.formatDate(this.eventDateValue);

    const payload: Partial<AppEvent> = {
      category_id: this.categoryId,
      title: this.title,
      event_date: eventDate,
      description: this.description || null,
      priority: this.priority,
      tags: this.tags,
      thread_id: resolvedThreadId,
      thread_order: threadOrder,
      company_id: this.entityLevel === 'company' ? this.entityId : null,
      product_id: this.entityLevel === 'product' ? this.entityId : null,
      trial_id: this.entityLevel === 'trial' ? this.entityId : null,
    };

    const validSources = this.sources.filter((s) => s.url.trim());

    try {
      const id = this.eventId();
      if (id) {
        await this.eventService.update(id, payload);
        await this.eventService.updateSources(id, validSources);
      } else {
        await this.eventService.create(spaceId, payload, validSources, this.linkedEventIds);
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not save event.');
    } finally {
      this.saving.set(false);
    }
  }

  private async loadData(spaceId: string): Promise<void> {
    try {
      const [cats, threads, companies, products, trials] = await Promise.all([
        this.eventCategoryService.list(spaceId),
        this.eventThreadService.listBySpace(spaceId),
        this.companyService.list(spaceId),
        this.productService.list(spaceId),
        this.trialService.listBySpace(spaceId),
      ]);
      this.categories.set(cats);
      this.threads.set(threads);
      this.companies.set(companies);
      this.products.set(products);
      this.trials.set(trials);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load form data.');
    }
  }

  private async loadExisting(eventId: string): Promise<void> {
    try {
      const detail = await this.eventService.getEventDetail(eventId);
      this.title = detail.title;
      this.eventDateValue = new Date(detail.event_date + 'T00:00:00');
      this.categoryId = detail.category.id;
      this.priority = detail.priority;
      this.description = detail.description ?? '';
      this.tags = detail.tags;
      this.threadId = detail.thread_id;

      // Determine entity level
      if (detail.entity_level === 'company' && detail.entity_id) {
        this.entityLevel = 'company';
        this.entityId = detail.entity_id;
        this.entityOptions.set(this.companies().map((c) => ({ id: c.id, name: c.name })));
      } else if (detail.entity_level === 'product' && detail.entity_id) {
        this.entityLevel = 'product';
        this.entityId = detail.entity_id;
        this.entityOptions.set(this.products().map((p) => ({ id: p.id, name: p.name })));
      } else if (detail.entity_level === 'trial' && detail.entity_id) {
        this.entityLevel = 'trial';
        this.entityId = detail.entity_id;
        this.entityOptions.set(this.trials().map((t) => ({ id: t.id, name: t.name })));
      } else {
        this.entityLevel = 'space';
      }

      // Load sources
      this.sources = detail.sources.map((s) => ({ url: s.url, label: s.label ?? '' }));

      // Linked events
      this.linkedEventIds = detail.linked_events.map((le) => le.id);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load event.');
    }
  }

  private getSpaceId(): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('spaceId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
