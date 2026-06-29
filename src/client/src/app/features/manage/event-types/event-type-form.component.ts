import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Select } from 'primeng/select';
import { ColorPicker } from 'primeng/colorpicker';
import { MessageModule } from 'primeng/message';

import { InnerMark, MarkerType, MarkerCategory } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { MarkerIconComponent } from '../../../shared/components/svg-icons/marker-icon.component';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';
import { taxonomyDuplicateNameMessage } from '../taxonomies/taxonomy-tabs.logic';
import {
  createInlineCategory,
  shouldOfferCategoryCreate,
} from './event-type-form.inline-category';
import {
  DEFAULT_EVENT_TYPE_SIGNIFICANCE,
  EVENT_TYPE_SIGNIFICANCE_OPTIONS,
  EventTypeSignificance,
} from './event-type-form.significance';

@Component({
  selector: 'app-event-type-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    Select,
    ColorPicker,
    MessageModule,
    MarkerIconComponent,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './event-type-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventTypeFormComponent implements OnInit {
  readonly eventType = input<MarkerType | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private markerTypeService = inject(MarkerTypeService);
  private categoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);

  readonly categories = signal<MarkerCategory[]>([]);

  readonly shapeOptions = [
    { label: 'Circle', value: 'circle' },
    { label: 'Diamond', value: 'diamond' },
    { label: 'Flag', value: 'flag' },
    { label: 'Triangle', value: 'triangle' },
    { label: 'Square', value: 'square' },
    { label: 'Hexagon', value: 'hexagon' },
    { label: 'Dashed line', value: 'dashed-line' },
  ];

  readonly fillStyleOptions = [
    { label: 'Filled', value: 'filled' },
    { label: 'Outline', value: 'outline' },
  ];

  readonly innerMarkOptions: { label: string; value: InnerMark }[] = [
    { label: 'None', value: 'none' },
    { label: 'Dot', value: 'dot' },
    { label: 'Dash', value: 'dash' },
    { label: 'Check', value: 'check' },
    { label: 'Cross', value: 'x' },
  ];

  readonly significanceOptions = EVENT_TYPE_SIGNIFICANCE_OPTIONS;

  readonly categoryId = signal('');
  readonly name = signal('');
  readonly shape = signal<MarkerType['shape']>('circle');
  readonly fillStyle = signal<MarkerType['fill_style']>('filled');
  readonly color = signal('#14b8a6');
  readonly innerMark = signal<InnerMark>('none');
  readonly defaultSignificance = signal<EventTypeSignificance>(DEFAULT_EVENT_TYPE_SIGNIFICANCE);
  readonly displayOrder = signal<number | null>(0);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly nameBlurred = signal(false);
  readonly categoryBlurred = signal(false);

  private readonly categorySelect = viewChild<Select>('categorySelect');
  readonly categoryFilter = signal('');
  readonly creatingCategory = signal(false);

  readonly nameInvalid = computed(() => this.nameBlurred() && !this.name().trim());
  readonly categoryInvalid = computed(() => this.categoryBlurred() && !this.categoryId());

  readonly createCategoryLabel = computed(() => this.categoryFilter().trim());
  readonly showCreateCategory = computed(() =>
    shouldOfferCategoryCreate(this.categoryFilter(), this.categories())
  );

  async ngOnInit(): Promise<void> {
    const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    try {
      this.categories.set(await this.categoryService.list(spaceId));
    } catch {
      /* categories will be empty */
    }

    const existing = this.eventType();
    if (existing) {
      this.name.set(existing.name);
      this.shape.set(existing.shape);
      this.fillStyle.set(existing.fill_style);
      this.color.set(existing.color);
      this.innerMark.set(existing.inner_mark ?? 'none');
      this.defaultSignificance.set(existing.default_significance ?? DEFAULT_EVENT_TYPE_SIGNIFICANCE);
      this.displayOrder.set(existing.display_order);
      this.categoryId.set(existing.category_id);
    }
  }

  onCategoryFilter(filter: string): void {
    this.categoryFilter.set(filter);
  }

  async createCategoryFromFilter(): Promise<void> {
    if (this.creatingCategory()) return;
    this.creatingCategory.set(true);
    this.error.set(null);
    try {
      const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
      const created = await createInlineCategory(
        this.categoryService,
        spaceId,
        this.categoryFilter()
      );
      if (!created) return;
      this.categories.update((list) => [...list, created]);
      this.categoryId.set(created.id);
      this.categoryFilter.set('');
      this.categorySelect()?.hide();
    } catch (e) {
      this.error.set(taxonomyDuplicateNameMessage(e, 'event category'));
    } finally {
      this.creatingCategory.set(false);
    }
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    this.categoryBlurred.set(true);
    const name = this.name().trim();
    if (!name) return;
    const categoryId = this.categoryId();
    if (!categoryId) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const payload: Partial<MarkerType> = {
        name,
        shape: this.shape(),
        fill_style: this.fillStyle(),
        color: this.color(),
        inner_mark: this.innerMark(),
        default_significance: this.defaultSignificance(),
        display_order: this.displayOrder() ?? 0,
        category_id: categoryId,
      };

      const existing = this.eventType();
      if (existing) {
        await this.markerTypeService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.markerTypeService.create(spaceId, payload);
      }
      this.saved.emit();
    } catch (e) {
      this.error.set(taxonomyDuplicateNameMessage(e, 'event type'));
    } finally {
      this.saving.set(false);
    }
  }
}
