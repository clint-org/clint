import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { TherapeuticArea } from '../../../core/models/trial.model';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-therapeutic-area-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './therapeutic-area-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TherapeuticAreaFormComponent implements OnInit {
  readonly area = input<TherapeuticArea | null>(null);

  readonly saved = output<TherapeuticArea>();
  readonly cancelled = output<void>();

  readonly name = signal('');
  readonly abbreviation = signal('');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly nameBlurred = signal(false);

  private areaService = inject(TherapeuticAreaService);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const a = this.area();
    if (a) {
      this.name.set(a.name);
      this.abbreviation.set(a.abbreviation ?? '');
    }
  }

  get isEdit(): boolean {
    return this.area() !== null;
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
      const payload: Partial<TherapeuticArea> = {
        name: this.name().trim(),
        abbreviation: this.abbreviation().trim() || null,
      };

      let result: TherapeuticArea;
      const existing = this.area();
      if (existing) {
        result = await this.areaService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        result = await this.areaService.create(spaceId, payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save therapeutic area');
    } finally {
      this.submitting.set(false);
    }
  }
}
