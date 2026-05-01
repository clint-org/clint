import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { PaletteResultRowComponent } from './palette-result-row.component';
import { EmptyState, PaletteItem } from '../../models/palette.model';

@Component({
  selector: 'app-palette-empty-state',
  standalone: true,
  imports: [PaletteResultRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state().pinned.length > 0) {
      <div class="border-b border-slate-100 py-2">
        <div class="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Pinned</div>
        @for (p of state().pinned; track p.id; let i = $index) {
          <app-palette-result-row
            [item]="p"
            [index]="i"
            [selected]="selectedFlatIndex() === i"
            (hover)="indexSelect.emit(i)"
            (activated)="activated.emit({ index: i, item: p })"
          />
        }
      </div>
    }
    @if (state().recents.length > 0) {
      <div class="border-b border-slate-100 py-2">
        <div class="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recent</div>
        @for (r of state().recents; track r.id; let i = $index) {
          <app-palette-result-row
            [item]="r"
            [index]="state().pinned.length + i"
            [selected]="selectedFlatIndex() === state().pinned.length + i"
            (hover)="indexSelect.emit(state().pinned.length + i)"
            (activated)="activated.emit({ index: state().pinned.length + i, item: r })"
          />
        }
      </div>
    }
    @if (state().commands.length > 0) {
      <div class="py-2">
        <div class="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Commands</div>
        @for (c of state().commands; track c.id; let i = $index) {
          <app-palette-result-row
            [item]="{ kind: 'command', command: c }"
            [index]="state().pinned.length + state().recents.length + i"
            [selected]="selectedFlatIndex() === state().pinned.length + state().recents.length + i"
            (hover)="indexSelect.emit(state().pinned.length + state().recents.length + i)"
            (activated)="activated.emit({ index: state().pinned.length + state().recents.length + i, item: { kind: 'command', command: c } })"
          />
        }
      </div>
    }
    @if (state().pinned.length === 0 && state().recents.length === 0 && state().commands.length === 0) {
      <div class="px-4 py-8 text-center text-sm text-slate-400">Start typing to search</div>
    }
  `,
})
export class PaletteEmptyStateComponent {
  readonly state = input.required<EmptyState>();
  readonly selectedFlatIndex = input<number>(0);
  readonly indexSelect = output<number>();
  readonly activated = output<{ index: number; item: PaletteItem }>();
}
