import { Component, input } from '@angular/core';

@Component({
  selector: 'app-form-field',
  standalone: true,
  template: `
    <div [class]="spacing()">
      <label [attr.for]="fieldId()" class="mb-1 block text-sm font-medium text-slate-700">
        {{ label() }}
        @if (required()) {
          <span class="text-red-500">*</span>
        }
      </label>
      <ng-content />
      @if (error()) {
        <p [id]="fieldId() + '-error'" class="mt-1 text-sm text-red-600">{{ error() }}</p>
      }
    </div>
  `,
})
export class FormFieldComponent {
  readonly label = input.required<string>();
  readonly fieldId = input.required<string>();
  readonly required = input(false);
  readonly error = input<string | null>(null);
  readonly spacing = input('mb-4');
}
