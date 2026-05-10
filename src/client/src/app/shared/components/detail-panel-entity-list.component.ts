import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Wraps a stack of <app-detail-panel-entity-row> elements. Tiny but exists
 * so the spacing between rows is owned by the primitive, not by every
 * caller.
 */
@Component({
  selector: 'app-detail-panel-entity-list',
  standalone: true,
  template: `
    <ul class="space-y-px">
      <ng-content />
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelEntityListComponent {}
