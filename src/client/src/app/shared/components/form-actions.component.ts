import { Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-form-actions',
  standalone: true,
  imports: [ButtonModule],
  template: `
    <div class="flex justify-end gap-3">
      <p-button
        label="Cancel"
        severity="secondary"
        [outlined]="true"
        (onClick)="cancelled.emit()"
      />
      <p-button [label]="submitLabel()" type="submit" [loading]="loading()" />
    </div>
  `,
})
export class FormActionsComponent {
  readonly submitLabel = input('Save');
  readonly loading = input(false);
  readonly cancelled = output<void>();
}
