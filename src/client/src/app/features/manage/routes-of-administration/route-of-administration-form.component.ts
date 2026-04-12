import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { RouteOfAdministration } from '../../../core/models/route-of-administration.model';
import { RouteOfAdministrationService } from '../../../core/services/route-of-administration.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-route-of-administration-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './route-of-administration-form.component.html',
})
export class RouteOfAdministrationFormComponent implements OnInit {
  item = input<RouteOfAdministration | null>(null);

  saved = output<RouteOfAdministration>();
  cancelled = output<void>();

  name = signal('');
  abbreviation = signal('');
  displayOrder = signal(0);
  submitting = signal(false);
  error = signal<string | null>(null);
  nameBlurred = signal(false);

  private roaService = inject(RouteOfAdministrationService);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const current = this.item();
    if (current) {
      this.name.set(current.name);
      this.abbreviation.set(current.abbreviation ?? '');
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
      const payload: Partial<RouteOfAdministration> = {
        name: this.name().trim(),
        abbreviation: this.abbreviation().trim() || null,
        display_order: this.displayOrder(),
      };

      let result: RouteOfAdministration;
      const existing = this.item();
      if (existing) {
        result = await this.roaService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        result = await this.roaService.create(spaceId, payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not save route of administration. Check your connection and try again.'
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
