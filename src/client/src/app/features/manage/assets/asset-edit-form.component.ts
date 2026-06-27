import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Select } from 'primeng/select';

import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { TaxonomyMultiselectComponent } from '../shared/taxonomy-multiselect/taxonomy-multiselect.component';
import type { CreateFn } from '../shared/taxonomy-multiselect/taxonomy-create-controller';

/**
 * Presentational asset form body. No persistence: the host owns option loading,
 * validation, and save. Consumed by the Manage asset form and the import-review
 * edit dialog (which hides Display Order via showDisplayOrder=false).
 */
@Component({
  selector: 'app-asset-edit-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    Select,
    TaxonomyMultiselectComponent,
    FormFieldComponent,
  ],
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
  // Inline-create hooks supplied by the host (persist + register the new
  // option). Null on read-only hosts (e.g. import review), degrading the field
  // to a plain multiselect.
  readonly moaCreateFn = input<CreateFn | null>(null);
  readonly roaCreateFn = input<CreateFn | null>(null);
  readonly nameInvalid = input<boolean>(false);
  readonly showDisplayOrder = input<boolean>(true);
  readonly showLogoUrl = input<boolean>(true);
  // Locks the identity fields (name / generic name / company) when the host has
  // linked this asset to an existing record, whose details the import does not
  // change. MOA/ROA stay editable because the commit merges them into the match.
  readonly disabled = input<boolean>(false);
  // Locks only the company select (leaving name / generic / MOA / ROA editable)
  // when a new asset is created from a company's detail page, where the company
  // is fixed to that page's company.
  readonly companyLocked = input<boolean>(false);
  readonly nameBlur = output<void>();
}
