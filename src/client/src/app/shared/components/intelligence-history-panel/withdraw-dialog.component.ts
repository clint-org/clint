import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';

/**
 * Withdraw confirmation. Required textarea becomes the public-facing
 * change_note attached to the withdrawal revision.
 */
@Component({
  selector: 'app-withdraw-intelligence-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, ButtonModule, FormsModule],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      header="Withdraw this read"
      [modal]="true"
      styleClass="!w-[32rem]"
      [closable]="true"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-700">
          The version stays in history with a "Withdrawn" badge. Use Purge to remove permanently.
        </p>
        <label
          for="withdraw-reason"
          class="block text-xs font-medium uppercase tracking-[0.16em] text-slate-600"
        >
          Reason (visible to clients)
        </label>
        <textarea
          id="withdraw-reason"
          class="w-full rounded border border-slate-300 p-2 text-sm"
          rows="3"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          aria-required="true"
        ></textarea>
      </div>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" (onClick)="cancelled.emit()" />
        <p-button
          label="Withdraw"
          severity="danger"
          [disabled]="reason().trim().length === 0"
          (onClick)="confirmed.emit(reason().trim())"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class WithdrawIntelligenceDialogComponent {
  readonly visible = input.required<boolean>();
  readonly cancelled = output<void>();
  readonly confirmed = output<string>();

  protected readonly reason = signal('');

  onVisibleChange(open: boolean): void {
    if (!open) this.cancelled.emit();
  }
}
