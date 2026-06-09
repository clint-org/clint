import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { MultiSelect } from 'primeng/multiselect';
import { Select } from 'primeng/select';

import { FormFieldComponent } from '../../../shared/components/form-field.component';

/**
 * Presentational asset form body. No persistence: the host owns option loading,
 * validation, and save. Consumed by the Manage asset form and the import-review
 * edit dialog (which hides Display Order via showDisplayOrder=false).
 */
@Component({
  selector: 'app-asset-edit-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, InputText, InputNumber, Select, MultiSelect, FormFieldComponent],
  templateUrl: './asset-edit-form.component.html',
})
export class AssetEditFormComponent {
  readonly name = model<string>('');
  readonly genericName = model<string>('');
  readonly companyId = model<string | null>(null);
  readonly logoUrl = model<string>('');
  readonly moaIds = model<string[]>([]);
  readonly roaIds = model<string[]>([]);
  readonly displayOrder = model<number | null>(null);
  readonly companyOptions = input<{ id: string; name: string }[]>([]);
  readonly moaOptions = input<{ id: string; name: string }[]>([]);
  readonly roaOptions = input<{ id: string; name: string }[]>([]);
  readonly nameInvalid = input<boolean>(false);
  readonly showDisplayOrder = input<boolean>(true);
  readonly showLogoUrl = input<boolean>(true);
  // Locks the identity fields (name / generic name / company) when the host has
  // linked this asset to an existing record, whose details the import does not
  // change. MOA/ROA stay editable because the commit merges them into the match.
  readonly disabled = input<boolean>(false);
  readonly nameBlur = output<void>();
}
