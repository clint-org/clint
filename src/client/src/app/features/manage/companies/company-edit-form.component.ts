import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';

import { FormFieldComponent } from '../../../shared/components/form-field.component';

/**
 * Presentational company form body. No persistence: the host owns load/save and
 * name validation. Consumed by both the Manage company form and the import-review
 * edit dialog.
 */
@Component({
  selector: 'app-company-edit-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, InputText, InputNumber, FormFieldComponent],
  templateUrl: './company-edit-form.component.html',
})
export class CompanyEditFormComponent {
  readonly name = model<string>('');
  readonly logoUrl = model<string>('');
  readonly displayOrder = model<number | null>(null);
  readonly nameInvalid = input<boolean>(false);
  readonly nameBlur = output<void>();
}
