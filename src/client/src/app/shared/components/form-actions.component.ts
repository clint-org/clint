import { Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-form-actions',
  standalone: true,
  imports: [ButtonModule],
  template: `
    <div class="flex justify-end gap-2 border-t border-slate-100 pt-4">
      <p-button
        label="Cancel"
        severity="secondary"
        [outlined]="true"
        size="small"
        (onClick)="cancelled.emit()"
      />
      <p-button
        [label]="submitLabel()"
        type="submit"
        size="small"
        [loading]="loading()"
        [disabled]="disabled()"
      />
    </div>
  `,
})
export class FormActionsComponent {
  readonly submitLabel = input('Save');
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly cancelled = output<void>();
}
