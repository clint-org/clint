import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { PiMarkComponent } from './pi-mark/pi-mark.component';

/**
 * Section primitive for detail panes. Owns the eyebrow + top divider rhythm
 * so every section across every pane lines up. Pass `first` for the first
 * section after the title meta strip; it gets a slightly larger top margin
 * to read as the first beat after the title block. Pass `piMark` for
 * primary-intelligence sections so the eyebrow carries the brand bookmark
 * glyph -- the same mark used on the data surfaces, for muscle memory.
 */
@Component({
  selector: 'app-detail-panel-section',
  imports: [PiMarkComponent],
  template: `
    <section class="border-t border-slate-100 pt-3" [class.mt-4]="first()" [class.mt-3]="!first()">
      @if (label()) {
        <p
          class="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest"
          [class.text-slate-400]="!piMark()"
          [class.text-brand-700]="piMark()"
        >
          @if (piMark()) {
            <app-pi-mark [size]="10" />
          }
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
  readonly piMark = input<boolean>(false);
}
