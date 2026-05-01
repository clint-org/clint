import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { PaletteResultRowComponent } from './palette-result-row.component';
import { PaletteItem } from '../../models/palette.model';

@Component({
  selector: 'app-palette-result-list',
  standalone: true,
  imports: [PaletteResultRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="px-4 py-2 text-[11px] text-slate-400">Searching...</div>
    }
    @if (!loading() && items().length === 0) {
      <div class="px-4 py-8 text-center text-sm text-slate-400">
        No matches in {{ scopeLabel() }}.
      </div>
    }
    <ul role="listbox" id="palette-results" class="max-h-[60vh] overflow-y-auto">
      @for (it of items(); track trackKey(it, $index); let i = $index) {
        <li>
          <app-palette-result-row
            [item]="it"
            [index]="i"
            [selected]="selectedIndex() === i"
            (hover)="indexSelect.emit(i)"
            (activated)="activated.emit({ index: i, item: it })"
          />
        </li>
      }
    </ul>
  `,
})
export class PaletteResultListComponent {
  readonly items = input.required<PaletteItem[]>();
  readonly selectedIndex = input<number>(0);
  readonly loading = input<boolean>(false);
  readonly scopeLabel = input<string>('');
  readonly indexSelect = output<number>();
  readonly activated = output<{ index: number; item: PaletteItem }>();

  trackKey(item: PaletteItem, index: number) {
    return item.kind === 'command' ? `cmd:${item.command.id}` : `${item.kind}:${item.id}:${index}`;
  }
}
