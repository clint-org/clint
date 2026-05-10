import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';

/**
 * Single-row overflow menu used across manage tables.
 *
 * Usage:
 *   <app-row-actions [items]="menuItemsFor(row)" ariaLabel="Actions for Farxiga" />
 *
 * The caller builds the MenuItem array with `command` callbacks; this
 * component just renders the ellipsis trigger and the popup menu.
 * Destructive items should set `styleClass: 'row-actions-danger'` so the
 * shared CSS colors them red.
 */
@Component({
  selector: 'app-row-actions',
  standalone: true,
  imports: [ButtonModule, MenuModule],
  template: `
    <p-button
      icon="fa-solid fa-ellipsis"
      [text]="true"
      severity="secondary"
      size="small"
      styleClass="row-actions-trigger"
      [attr.aria-label]="ariaLabel()"
      (onClick)="menu.toggle($event)"
    />
    <p-menu #menu [model]="items()" [popup]="true" appendTo="body" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowActionsComponent {
  readonly items = input.required<MenuItem[]>();
  readonly ariaLabel = input<string>('Row actions');
}
