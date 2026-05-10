import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Canonical container for every detail pane (marker, event, positioning,
 * bullseye). Owns the header strip, scroll body, and footer slot, plus the
 * accessibility primitives (aria-live, escape-to-close).
 *
 * Two density variants:
 *   - `compact`: 340px-class drawer over the timeline (smaller header/close,
 *     tighter top padding).
 *   - `roomy`: persistent column on /catalysts /events /landscape (default).
 *
 * Header label tone:
 *   - `brand`: object class shown when something is selected (e.g.
 *     "Clinical Readout · Phase 3 Topline"). Reads as the lens.
 *   - `muted`: passive overview eyebrow shown in empty states (e.g.
 *     "Catalysts · overview").
 */
@Component({
  selector: 'app-detail-panel-shell',
  standalone: true,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <aside
      class="flex h-full flex-col bg-white"
      [class.border]="bordered()"
      [class.border-slate-200]="bordered()"
      role="region"
      [attr.aria-label]="ariaLabel() || label()"
      aria-live="polite"
    >
      @if (showHeader()) {
        <header
          class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5"
          [class.py-2.5]="density() === 'compact'"
          [class.py-3]="density() === 'roomy'"
        >
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <ng-content select="[headerLeading]" />
            @if (label()) {
              <p
                class="truncate text-[10px] font-semibold uppercase tracking-widest"
                [class.text-brand-600]="labelTone() === 'brand'"
                [class.text-slate-400]="labelTone() === 'muted'"
              >
                {{ label() }}
              </p>
            }
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <ng-content select="[headerActions]" />
            @if (showClose()) {
              <button
                type="button"
                class="flex shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                [class.h-6]="density() === 'compact'"
                [class.w-6]="density() === 'compact'"
                [class.h-7]="density() === 'roomy'"
                [class.w-7]="density() === 'roomy'"
                (click)="closed.emit()"
                aria-label="Close detail panel"
              >
                <i class="fa-solid fa-xmark text-xs"></i>
              </button>
            }
          </div>
        </header>
      }
      <div
        class="flex-1 overflow-y-auto px-5"
        [class.pt-3]="density() === 'compact'"
        [class.pt-4]="density() === 'roomy'"
        [class.pb-3]="density() === 'compact'"
        [class.pb-4]="density() === 'roomy'"
      >
        <ng-content />
      </div>
      <ng-content select="[footer]" />
    </aside>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelShellComponent {
  readonly label = input<string>('');
  readonly labelTone = input<'brand' | 'muted'>('brand');
  readonly ariaLabel = input<string>('');
  readonly density = input<'compact' | 'roomy'>('roomy');
  readonly showHeader = input<boolean>(true);
  readonly showClose = input<boolean>(true);
  readonly bordered = input<boolean>(true);
  readonly closed = output<void>();

  protected readonly densityClasses = computed(() => ({
    headerPad: this.density() === 'compact' ? 'py-2.5' : 'py-3',
    closeSize: this.density() === 'compact' ? 'h-6 w-6' : 'h-7 w-7',
    bodyPadY: this.density() === 'compact' ? 'pt-3 pb-3' : 'pt-4 pb-4',
  }));

  onEscape(): void {
    if (this.showClose()) this.closed.emit();
  }
}
