import { Component, input } from '@angular/core';

@Component({
  selector: 'app-manage-page-shell',
  standalone: true,
  template: `
    <div class="page-shell" [class.page-shell--narrow]="narrow()">
      <ng-content />
    </div>
  `,
})
export class ManagePageShellComponent {
  /** Cap the shell to a narrower width for form-heavy detail pages. */
  readonly narrow = input<boolean>(false);
}
