import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-form-field',
  standalone: true,
  template: `
    <div [class]="spacing()">
      <label
        [attr.for]="fieldId()"
        class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500"
      >
        {{ label() }}
        @if (required()) {
          <span class="ml-0.5 text-red-600">*</span>
        }
      </label>
      <ng-content />
      @if (error()) {
        <p [id]="fieldId() + '-error'" class="mt-1 text-[11px] text-red-700">{{ error() }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormFieldComponent {
  readonly label = input.required<string>();
  readonly fieldId = input.required<string>();
  readonly required = input(false);
  readonly error = input<string | null>(null);
  readonly spacing = input('mb-4');
}
