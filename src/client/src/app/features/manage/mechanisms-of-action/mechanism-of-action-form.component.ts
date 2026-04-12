import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Textarea } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-mechanism-of-action-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    Textarea,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './mechanism-of-action-form.component.html',
})
export class MechanismOfActionFormComponent implements OnInit {
  item = input<MechanismOfAction | null>(null);

  saved = output<MechanismOfAction>();
  cancelled = output<void>();

  name = signal('');
  description = signal('');
  displayOrder = signal(0);
  submitting = signal(false);
  error = signal<string | null>(null);
  nameBlurred = signal(false);

  private moaService = inject(MechanismOfActionService);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const current = this.item();
    if (current) {
      this.name.set(current.name);
      this.description.set(current.description ?? '');
      this.displayOrder.set(current.display_order);
    }
  }

  get isEdit(): boolean {
    return this.item() !== null;
  }

  get nameInvalid(): boolean {
    return this.nameBlurred() && this.name().trim().length === 0;
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    if (this.name().trim().length === 0) return;

    this.submitting.set(true);
    this.error.set(null);

    try {
      const payload: Partial<MechanismOfAction> = {
        name: this.name().trim(),
        description: this.description().trim() || null,
        display_order: this.displayOrder(),
      };

      let result: MechanismOfAction;
      const existing = this.item();
      if (existing) {
        result = await this.moaService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        result = await this.moaService.create(spaceId, payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not save mechanism of action. Check your connection and try again.'
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
