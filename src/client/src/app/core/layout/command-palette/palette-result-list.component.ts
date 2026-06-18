import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { PaletteResultRowComponent } from './palette-result-row.component';
import { PaletteItem } from '../../models/palette.model';
import { noMatchesLabel } from './no-matches-label';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';

@Component({
  selector: 'app-palette-result-list',
  standalone: true,
  imports: [PaletteResultRowComponent, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <app-loader class="px-4 py-2" [size]="16" label="Searching" />
    }
    @if (!loading() && items().length === 0) {
      <div class="px-4 py-8 text-center text-sm text-slate-400">
        {{ emptyMessage() }}
      </div>
    }
    <ul role="listbox" id="palette-results" class="max-h-[60vh] overflow-y-auto">
      @for (it of items(); track trackKey(it, $index)) {
        <li>
          <app-palette-result-row
            [item]="it"
            [index]="$index"
            [selected]="selectedIndex() === $index"
            (hover)="indexSelect.emit($index)"
            (activated)="activated.emit({ index: $index, item: it })"
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

  readonly emptyMessage = computed(() => noMatchesLabel(this.scopeLabel()));

  trackKey(item: PaletteItem, index: number) {
    return item.kind === 'command' ? `cmd:${item.command.id}` : `${item.kind}:${item.id}:${index}`;
  }
}
