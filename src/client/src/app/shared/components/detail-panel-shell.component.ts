import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-detail-panel-shell',
  standalone: true,
  template: `
    <aside
      class="flex h-full flex-col border border-slate-200 bg-white"
      aria-live="polite"
    >
      @if (showHeader()) {
        <div class="flex shrink-0 items-center justify-between px-5 py-3">
          <p class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            {{ label() }}
          </p>
          @if (showClose()) {
            <button
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
              (click)="closed.emit()"
              aria-label="Clear selection"
            >
              <i class="fa-solid fa-xmark text-xs"></i>
            </button>
          }
        </div>
      }
      <div class="flex-1 overflow-y-auto px-5 pb-4" [class.pt-4]="!showHeader()">
        <ng-content />
      </div>
      <ng-content select="[actions]" />
    </aside>
  `,
})
export class DetailPanelShellComponent {
  readonly label = input<string>('');
  readonly showHeader = input<boolean>(true);
  readonly showClose = input<boolean>(true);
  readonly closed = output<void>();
}
