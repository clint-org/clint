import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MultiSelect } from 'primeng/multiselect';
import { DatePicker } from 'primeng/datepicker';
import { Tooltip } from 'primeng/tooltip';

import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { TaxonomyMultiselectComponent } from '../shared/taxonomy-multiselect/taxonomy-multiselect.component';
import type { CreateFn } from '../shared/taxonomy-multiselect/taxonomy-create-controller';

interface SelectOption {
  id: string;
  name: string;
}

/**
 * Presentational trial form body. No persistence: the host owns option loading,
 * validation, and save. Shared by the Profiles trial edit dialog and the
 * import-review edit dialog.
 *
 * Indication is a multi-select of {id,name} options; the host decides what the
 * option `id` means -- Profiles binds indication UUIDs, the review dialog binds
 * indication NAMES (the import commit resolves names). The component is agnostic.
 *
 * The Profiles trial create dialog is intentionally NOT a consumer: its single-asset +
 * NCT-autopopulate flow diverges enough that sharing would balloon the surface.
 */
@Component({
  selector: 'app-trial-edit-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    InputTextModule,
    Select,
    MultiSelect,
    TaxonomyMultiselectComponent,
    DatePicker,
    Tooltip,
    FormFieldComponent,
  ],
  templateUrl: './trial-edit-form.component.html',
})
export class TrialEditFormComponent {
  readonly name = model<string>('');
  readonly identifier = model<string | null>(null);
  // A trial can test multiple assets; assetIds is the membership and
  // primaryAssetId (one of assetIds) is the headline asset.
  readonly assetIds = model<string[]>([]);
  readonly primaryAssetId = model<string | null>(null);
  // Selected indication option ids (UUIDs in Profiles, names in review).
  readonly indicationIds = model<string[]>([]);
  readonly phaseType = model<string | null>(null);
  readonly phaseStart = model<string | null>(null); // YYYY-MM-DD
  readonly phaseEnd = model<string | null>(null);

  readonly assetOptions = input<SelectOption[]>([]);
  readonly indicationOptions = input<SelectOption[]>([]);
  readonly phaseOptions = input<SelectOption[]>([]);
  // Inline-create hook for indications, supplied by the host. Null on hosts
  // whose option ids are names rather than UUIDs (the import review dialog),
  // degrading the field to a plain multiselect.
  readonly indicationCreateFn = input<CreateFn | null>(null);

  readonly identifierReadonly = input<boolean>(false);
  // Locks every field when the host has linked this trial to an existing record.
  // The import commit ignores all proposal fields for an existing-match trial
  // (it links by id), so editing them here would be a no-op.
  readonly disabled = input<boolean>(false);
  readonly phaseTypeLocked = input<boolean>(false);
  readonly phaseStartLocked = input<boolean>(false);
  readonly phaseEndLocked = input<boolean>(false);
  // Non-null when the underlying marker is approximate (e.g. "~Q3 '26"); the
  // field then renders the period caption read-only instead of a day-precise
  // picker, since precision is edited in the marker editor.
  readonly phaseStartApproxLabel = input<string | null>(null);
  readonly phaseEndApproxLabel = input<string | null>(null);
  readonly nameInvalid = input<boolean>(false);
  readonly nameBlur = output<void>();

  // Primary-asset choices are the currently selected assets.
  protected readonly primaryOptions = computed(() => {
    const sel = new Set(this.assetIds());
    return this.assetOptions().filter((o) => sel.has(o.id));
  });

  protected readonly phaseStartDate = computed(() => this.parseDate(this.phaseStart()));
  protected readonly phaseEndDate = computed(() => this.parseDate(this.phaseEnd()));

  // MultiSelect with showClear can emit null; coalesce to [].
  protected onIndicationsChange(ids: string[] | null): void {
    this.indicationIds.set(ids ?? []);
  }

  // MultiSelect with showClear can emit null; coalesce to []. Keep the primary in
  // sync: default to the first member, clear when no assets remain.
  protected onAssetsChange(ids: string[] | null): void {
    const next = ids ?? [];
    this.assetIds.set(next);
    const primary = this.primaryAssetId();
    if (next.length === 0) {
      this.primaryAssetId.set(null);
    } else if (primary === null || !next.includes(primary)) {
      this.primaryAssetId.set(next[0]);
    }
  }

  protected setPhaseStartDate(date: Date | null): void {
    this.phaseStart.set(date ? this.formatDate(date) : null);
  }

  protected setPhaseEndDate(date: Date | null): void {
    this.phaseEnd.set(date ? this.formatDate(date) : null);
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
