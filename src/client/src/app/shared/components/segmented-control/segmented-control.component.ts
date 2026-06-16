import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  viewChildren,
} from '@angular/core';

import { nextSegmentIndex } from './segmented-control.util';

export interface SegmentedOption {
  value: string;
  label: string;
}

/**
 * Vertical segmented control: a single connected group of mutually exclusive
 * options. One idiom for the landscape side-panel selectors (GROUP BY, COUNT)
 * across the heatmap and bullseye, replacing the two divergent hand-rolled
 * controls (stacked chip-buttons vs a horizontal segment). Vertical because the
 * grouping labels ("Mechanism of Action", "Route of Administration") are too
 * long for a horizontal segment in a 260px panel.
 *
 * Accessible as a radiogroup: roving tabindex, arrow/Home/End keys move and
 * select, click selects.
 */
@Component({
  selector: 'app-segmented-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="segmented" role="radiogroup" [attr.aria-label]="ariaLabel()">
      @for (opt of options(); track opt.value) {
        <button
          #seg
          type="button"
          role="radio"
          class="segmented__option"
          [class.active]="opt.value === value()"
          [attr.aria-checked]="opt.value === value()"
          [attr.tabindex]="$index === focusIndex() ? 0 : -1"
          (click)="select(opt.value)"
          (keydown)="onKeydown($event)"
        >
          {{ opt.label }}
        </button>
      }
    </div>
  `,
  styles: `
    .segmented {
      display: flex;
      flex-direction: column;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
      background: white;
    }

    .segmented__option {
      padding: 6px 10px;
      border: 0;
      border-top: 1px solid #e2e8f0;
      background: white;
      color: #64748b;
      font-size: 12px;
      font-weight: 500;
      text-align: left;
      cursor: pointer;
      transition:
        background 0.15s,
        color 0.15s;
    }

    .segmented__option:first-child {
      border-top: 0;
    }

    .segmented__option:hover {
      background: #f8fafc;
      color: #334155;
    }

    .segmented__option.active {
      background: var(--brand-50, #f0fdfa);
      color: var(--brand-700, #0f766e);
      font-weight: 600;
      box-shadow: inset 2px 0 0 var(--brand-600, #0d9488);
    }

    .segmented__option:focus-visible {
      outline: 2px solid var(--brand-500, #14b8a6);
      outline-offset: -2px;
      z-index: 1;
    }
  `,
})
export class SegmentedControlComponent {
  readonly options = input.required<readonly SegmentedOption[]>();
  readonly value = input<string>();
  readonly ariaLabel = input<string>('');

  readonly valueChange = output<string>();

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('seg');

  /** The roving-tabindex anchor: the selected option, or the first one. */
  protected readonly focusIndex = computed(() => {
    const idx = this.options().findIndex((o) => o.value === this.value());
    return idx >= 0 ? idx : 0;
  });

  protected select(value: string): void {
    if (value !== this.value()) this.valueChange.emit(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const opts = this.options();
    const next = nextSegmentIndex(event.key, this.focusIndex(), opts.length);
    if (next === null) return;
    event.preventDefault();
    this.select(opts[next].value);
    this.buttons()[next]?.nativeElement.focus();
  }
}
