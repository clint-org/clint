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
import { MessageModule } from 'primeng/message';

import { MarkerCategory } from '../../../core/models/marker.model';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-marker-category-form',
  standalone: true,
  imports: [FormsModule, InputText, MessageModule, FormFieldComponent, FormActionsComponent],
  templateUrl: './marker-category-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerCategoryFormComponent implements OnInit {
  readonly category = input<MarkerCategory | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private categoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);

  readonly name = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly nameBlurred = signal(false);
  readonly nameInvalid = computed(() => this.nameBlurred() && !this.name().trim());

  ngOnInit(): void {
    const existing = this.category();
    if (existing) this.name.set(existing.name);
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    const name = this.name().trim();
    if (!name) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const existing = this.category();
      if (existing) {
        await this.categoryService.update(existing.id, { name });
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.categoryService.create(spaceId, name);
      }
      this.saved.emit();
    } catch (e) {
      this.error.set(
        e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
          ? e.message
          : 'Could not save category. Check your connection and try again.'
      );
    } finally {
      this.saving.set(false);
    }
  }
}
