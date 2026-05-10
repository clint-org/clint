import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Section primitive for detail panes. Owns the eyebrow + top divider rhythm
 * so every section across every pane lines up. Pass `first` for the first
 * section after the title meta strip; it gets a slightly larger top margin
 * to read as the first beat after the title block.
 */
@Component({
  selector: 'app-detail-panel-section',
  standalone: true,
  template: `
    <section class="border-t border-slate-100 pt-3" [class.mt-4]="first()" [class.mt-3]="!first()">
      @if (label()) {
        <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {{ label() }}
        </p>
      }
      <ng-content />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelSectionComponent {
  readonly label = input<string>('');
  readonly first = input<boolean>(false);
}
