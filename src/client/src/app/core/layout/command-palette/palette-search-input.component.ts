import { Component, ChangeDetectionStrategy, input, output, ElementRef, viewChild, AfterViewInit } from '@angular/core';
import { ParsedQuery, PaletteScope } from '../../models/palette.model';

@Component({
  selector: 'app-palette-search-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
      <span class="rounded-sm bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-900">
        {{ scopeChipLabel() }}
      </span>
      <input
        #input
        type="text"
        autocomplete="off"
        spellcheck="false"
        aria-controls="palette-results"
        [attr.aria-activedescendant]="activeDescendantId()"
        [value]="query()"
        (input)="queryChange.emit($any($event.target).value)"
        (keydown)="onKeydown($event)"
        class="flex-1 bg-transparent font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400"
        placeholder="Search..."
      />
    </div>
  `,
})
export class PaletteSearchInputComponent implements AfterViewInit {
  readonly query = input<string>('');
  readonly parsed = input<ParsedQuery>({ token: null, term: '' });
  readonly scope = input<PaletteScope>('space');
  readonly scopeName = input<string>('');
  readonly activeDescendantId = input<string | null>(null);

  readonly queryChange = output<string>();
  readonly arrow = output<'up' | 'down' | 'home' | 'end'>();
  readonly enter = output<{ withModifier: boolean }>();
  readonly escape = output<void>();
  readonly tab = output<void>();
  readonly togglePin = output<void>();

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');

  ngAfterViewInit(): void {
    queueMicrotask(() => this.inputRef().nativeElement.focus());
  }

  scopeChipLabel(): string {
    const tokenSuffix = (() => {
      switch (this.parsed().token) {
        case '>': return ' / Commands';
        case '@': return ' / Companies';
        case '#': return ' / Trials';
        case '!': return ' / Catalysts';
        default:  return '';
      }
    })();
    const base = this.scope() === 'all-spaces' ? 'All spaces' : (this.scopeName() || 'Space');
    return base + tokenSuffix;
  }

  onKeydown(ev: KeyboardEvent) {
    switch (ev.key) {
      case 'ArrowUp':   ev.preventDefault(); this.arrow.emit('up'); break;
      case 'ArrowDown': ev.preventDefault(); this.arrow.emit('down'); break;
      case 'Home':      ev.preventDefault(); this.arrow.emit('home'); break;
      case 'End':       ev.preventDefault(); this.arrow.emit('end'); break;
      case 'Enter':     ev.preventDefault(); this.enter.emit({ withModifier: ev.metaKey || ev.ctrlKey }); break;
      case 'Escape':    ev.preventDefault(); this.escape.emit(); break;
      case 'Tab':       ev.preventDefault(); this.tab.emit(); break;
      case 'p':
      case 'P':
        if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey) {
          ev.preventDefault();
          this.togglePin.emit();
        }
        break;
    }
  }
}
