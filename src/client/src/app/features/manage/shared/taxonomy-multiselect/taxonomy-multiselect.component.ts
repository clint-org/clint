import { ChangeDetectionStrategy, Component, input, model, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MultiSelect, MultiSelectModule } from 'primeng/multiselect';

import { createTaxonomyController, type CreateFn } from './taxonomy-create-controller';
import type { TaxonomyOption } from './taxonomy-match';

/**
 * Multiselect for per-space taxonomy values (indication, mechanism, route) with
 * inline type-to-create. When the typed value has no exact match, the panel
 * footer offers a "Create '<value>'" row (name only); near-duplicates surface as
 * clickable "Similar" suggestions to steer reuse. Service-agnostic: the parent
 * supplies `createFn` (wired to the relevant service's create) and appends the
 * new option to its own `options` signal via `optionCreated`.
 *
 * Create/footer logic lives in taxonomy-create-controller (unit-tested); this
 * component only binds PrimeNG events and templates to it. The supplied
 * `createFn` is responsible for both persisting the value and registering it in
 * the parent's `options` signal so it renders as selected.
 */
@Component({
  selector: 'app-taxonomy-multiselect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MultiSelectModule],
  templateUrl: './taxonomy-multiselect.component.html',
})
export class TaxonomyMultiselectComponent {
  readonly options = input.required<TaxonomyOption[]>();
  readonly value = model<string[]>([]);
  /** When null the Create affordance is hidden (read-only / non-editor). */
  readonly createFn = input<CreateFn | null>(null);
  /** Singular noun for copy, e.g. "mechanism", "route", "indication". */
  readonly entityLabel = input.required<string>();
  readonly inputId = input<string>('');
  readonly placeholder = input<string>('Select');
  readonly selectedItemsLabel = input<string>('{0} selected');
  readonly maxSelectedLabels = input<number>(0);
  readonly disabled = input<boolean>(false);
  readonly styleClass = input<string>('w-full');
  /** Pass 'body' when hosted inside an overlay/dialog so the panel is not clipped. */
  readonly appendTo = input<'body' | 'self' | null>(null);

  private readonly multiselect = viewChild<MultiSelect>('ms');

  protected readonly controller = createTaxonomyController({
    options: this.options,
    value: this.value,
    createFn: this.createFn,
  });

  protected onFilter(filter: string): void {
    this.controller.setFilter(filter);
  }

  protected async onCreate(): Promise<void> {
    const created = await this.controller.create();
    // Close on success so resetFilterOnHide clears the typed text; keep the
    // panel and filter open on failure so the user can retry.
    if (created) this.multiselect()?.hide();
  }

  protected onSelectExisting(option: TaxonomyOption): void {
    this.controller.selectExisting(option);
    this.multiselect()?.hide();
  }
}
