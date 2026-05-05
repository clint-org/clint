import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';

/**
 * Single clickable (or static) row in a detail-pane entity list. Owns the
 * hover state, focus ring, padding, and the trailing arrow affordance.
 * Drop content directly inside via projection - no fixed slots so each
 * pane composes its own row layout (date + title, marker glyph + label,
 * etc).
 *
 * Set `clickable=false` for read-only rows (e.g. recent markers in the
 * bullseye empty state where there's nowhere to navigate to). The row
 * stays in the same visual family but sheds the button affordance.
 */
@Component({
  selector: 'app-detail-panel-entity-row',
  standalone: true,
  imports: [NgTemplateOutlet],
  // Single <ng-content/> captured into #content and rendered via
  // NgTemplateOutlet in both branches. Two unselected <ng-content/> slots
  // in @if/@else don't both receive projected content - only one wins,
  // and it's the wrong one for the active branch.
  template: `
    <ng-template #content><ng-content /></ng-template>
    <li class="list-none">
      @if (clickable()) {
        <button
          type="button"
          class="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-brand-500"
          (click)="rowClick.emit()"
          [attr.aria-label]="ariaLabel() || null"
        >
          <ng-container *ngTemplateOutlet="content" />
          <i
            class="fa-solid fa-arrow-right ml-auto text-[10px] text-slate-300 group-hover:text-brand-600"
            aria-hidden="true"
          ></i>
        </button>
      } @else {
        <div class="flex w-full items-center gap-2 px-2 py-1.5">
          <ng-container *ngTemplateOutlet="content" />
        </div>
      }
    </li>
  `,
})
export class DetailPanelEntityRowComponent {
  readonly clickable = input<boolean>(true);
  readonly ariaLabel = input<string>('');
  readonly rowClick = output<void>();
}
