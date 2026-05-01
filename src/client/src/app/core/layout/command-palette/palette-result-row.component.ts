import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { PaletteItem } from '../../models/palette.model';

@Component({
  selector: 'app-palette-result-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      role="option"
      [attr.id]="rowId()"
      [attr.aria-selected]="selected()"
      class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm"
      [class.bg-slate-100]="selected()"
      (mouseenter)="hover.emit()"
      (click)="activate.emit()"
    >
      <span class="h-3.5 w-3.5 shrink-0 rounded-sm" [style.background-color]="kindColor()"></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-slate-900">{{ primary() }}</span>
        @if (secondary()) {
          <span class="block truncate font-mono text-[11px] text-slate-500">{{ secondary() }}</span>
        }
      </span>
      <span class="ml-auto shrink-0 font-mono text-[11px] uppercase tracking-wide text-slate-500">
        {{ kindLabel() }}
      </span>
    </button>
  `,
})
export class PaletteResultRowComponent {
  readonly item = input.required<PaletteItem>();
  readonly selected = input<boolean>(false);
  readonly index = input<number>(0);
  readonly hover = output<void>();
  readonly activate = output<void>();

  rowId() { return `palette-row-${this.index()}`; }

  primary() {
    const it = this.item();
    return it.kind === 'command' ? it.command.label : it.name;
  }
  secondary() {
    const it = this.item();
    if (it.kind === 'command') return it.command.hint ?? null;
    return it.secondary;
  }
  kindLabel() {
    const it = this.item();
    if (it.kind === 'command') return 'Command';
    return it.kind.charAt(0).toUpperCase() + it.kind.slice(1);
  }
  kindColor() {
    const it = this.item();
    switch (it.kind) {
      case 'trial':    return '#0f766e';
      case 'product':  return '#0891b2';
      case 'company':  return '#475569';
      case 'event':    return '#ea580c';
      case 'catalyst': return '#16a34a';
      case 'command':  return '#7c3aed';
    }
  }
}
