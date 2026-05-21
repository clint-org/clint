import {
  ChangeDetectionStrategy,
  Component,
  computed,
  OnDestroy,
  signal,
} from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';

import {
  _registerConfirmDeleteOpener,
  type ConfirmDeleteOptions,
  type FormattedCountRow,
  formatCountBreakdown,
  resolveTypedConfirmationValue,
} from '../../utils/confirm-delete';

/**
 * The cascade-safety confirm-delete dialog. Mounted once at app root
 * (next to `<p-confirmdialog />`); the `confirmDelete()` helper finds it
 * via a module-level opener registration so feature components do not
 * need to import or inject anything extra.
 *
 * Renders three blocks:
 *   1. Header: the destructive action title + the entity label.
 *   2. Body: a lead-in line, a count-breakdown table (zero-suppressed),
 *      and an optional follow-up note.
 *   3. Footer: the typed-confirmation input (when required) plus
 *      Cancel and Confirm buttons. Confirm is disabled until the input
 *      matches the required value exactly. Cancel resolves the opener
 *      promise to false; Confirm resolves to true.
 *
 * PrimeNG's global `<p-confirmdialog />` cannot host an input field, so
 * this is a dedicated `Dialog` component rather than a confirm-dialog
 * variant.
 */
@Component({
  selector: 'app-confirm-delete-dialog',
  standalone: true,
  imports: [Dialog, ButtonModule, InputText],
  templateUrl: './confirm-delete-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDeleteDialogComponent implements OnDestroy {
  /** Visibility flag bound to the PrimeNG Dialog. */
  protected readonly visible = signal(false);

  /** Active options for the currently-open dialog, if any. */
  protected readonly opts = signal<ConfirmDeleteOptions | null>(null);

  /** The user-typed string in the confirmation input. */
  protected readonly typed = signal('');

  /** Resolves the Promise returned by the opener for the current dialog. */
  private resolver: ((value: boolean) => void) | null = null;

  /**
   * The literal string the user must type. Null when the dialog is not
   * gated (legacy plain-confirm callers should not be reaching this
   * dialog at all, but we tolerate null for safety).
   */
  protected readonly requiredTyped = computed<string | null>(() => {
    const o = this.opts();
    if (o === null) return null;
    return resolveTypedConfirmationValue(o);
  });

  /** True when the typed input matches the required value exactly. */
  protected readonly typedMatches = computed<boolean>(() => {
    const required = this.requiredTyped();
    if (required === null) return true;
    return this.typed() === required;
  });

  /** Pre-formatted, zero-suppressed count breakdown rows. */
  protected readonly countRows = computed<FormattedCountRow[]>(() => {
    const o = this.opts();
    if (o?.counts === undefined) return [];
    return formatCountBreakdown(o.counts);
  });

  /** Confirm button label, defaulting to "Delete". */
  protected readonly acceptLabel = computed<string>(() => this.opts()?.acceptLabel ?? 'Delete');

  /** Cancel button label, defaulting to "Cancel". */
  protected readonly rejectLabel = computed<string>(() => this.opts()?.rejectLabel ?? 'Cancel');

  constructor() {
    _registerConfirmDeleteOpener((opts) => this.open(opts));
  }

  ngOnDestroy(): void {
    _registerConfirmDeleteOpener(null);
  }

  /**
   * Opens the dialog with the given options and returns a Promise that
   * resolves true on Confirm, false on Cancel or dismiss. If the dialog
   * is already open (a rare race), the prior caller's Promise resolves
   * false so it cleans up cleanly before the new dialog takes over.
   */
  open(opts: ConfirmDeleteOptions): Promise<boolean> {
    if (this.resolver !== null) {
      this.resolver(false);
      this.resolver = null;
    }
    this.opts.set(opts);
    this.typed.set('');
    this.visible.set(true);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  protected onTypedInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.typed.set(target?.value ?? '');
  }

  protected onAccept(): void {
    if (!this.typedMatches()) return;
    this.finish(true);
  }

  protected onReject(): void {
    this.finish(false);
  }

  protected onHide(): void {
    // PrimeNG fires onHide for both explicit close and Escape / mask
    // dismiss. Treat any close that did not flow through onAccept /
    // onReject as a Cancel.
    if (this.resolver !== null) {
      this.finish(false);
    }
  }

  private finish(value: boolean): void {
    const r = this.resolver;
    this.resolver = null;
    this.visible.set(false);
    if (r !== null) r(value);
  }
}
