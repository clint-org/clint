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
import { InputNumber } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';

import { MarkerCategory } from '../../../core/models/marker.model';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';
import { taxonomyDuplicateNameMessage } from '../taxonomies/taxonomy-tabs.logic';

@Component({
  selector: 'app-event-category-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './event-category-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCategoryFormComponent implements OnInit {
  readonly category = input<MarkerCategory | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private categoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);

  readonly name = signal('');
  readonly displayOrder = signal<number | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly nameBlurred = signal(false);
  readonly nameInvalid = computed(() => this.nameBlurred() && !this.name().trim());

  ngOnInit(): void {
    const existing = this.category();
    if (existing) {
      this.name.set(existing.name);
      this.displayOrder.set(existing.display_order);
    }
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    const name = this.name().trim();
    if (!name) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const existing = this.category();
      const order = this.displayOrder();
      if (existing) {
        await this.categoryService.update(existing.id, {
          name,
          ...(order != null ? { display_order: order } : {}),
        });
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        // Service auto-assigns the next order after the system rows; only push
        // an explicit override when the editor set one.
        const created = await this.categoryService.create(spaceId, name);
        if (order != null && order !== created.display_order) {
          await this.categoryService.update(created.id, { display_order: order });
        }
      }
      this.saved.emit();
    } catch (e) {
      this.error.set(taxonomyDuplicateNameMessage(e, 'event category'));
    } finally {
      this.saving.set(false);
    }
  }
}
