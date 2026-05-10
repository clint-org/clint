import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';

/**
 * Type-to-confirm purge. The "Purge" button is disabled until the user
 * types the exact target headline.
 */
@Component({
  selector: 'app-purge-intelligence-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, ButtonModule, FormsModule],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      header="Purge this read"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [closable]="true"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-700">
          This permanently deletes the read{{ purgeAnchor() ? ' and every prior version' : '' }}.
          It cannot be undone.
        </p>
        <p class="text-xs uppercase tracking-[0.16em] text-slate-500">
          Type the version headline to confirm:
        </p>
        <p class="rounded bg-slate-50 p-2 text-sm font-mono text-slate-800">"{{ headline() }}"</p>
        <input
          id="purge-confirmation"
          type="text"
          class="w-full rounded border border-slate-300 p-2 text-sm"
          [ngModel]="entered()"
          (ngModelChange)="entered.set($event)"
          [attr.aria-label]="'Type ' + headline() + ' to confirm purge'"
        />
      </div>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" (onClick)="cancelled.emit()" />
        <p-button
          label="Purge"
          severity="danger"
          [disabled]="!matches()"
          (onClick)="confirmed.emit(entered())"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class PurgeIntelligenceDialogComponent {
  readonly visible = input.required<boolean>();
  readonly headline = input.required<string>();
  readonly purgeAnchor = input<boolean>(false);

  readonly cancelled = output<void>();
  readonly confirmed = output<string>();

  protected readonly entered = signal('');
  protected readonly matches = computed(() => this.entered() === this.headline());

  onVisibleChange(open: boolean): void {
    if (!open) this.cancelled.emit();
  }
}
