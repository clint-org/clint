import { ConfirmationService } from 'primeng/api';

/**
 * Promise-shaped wrapper around ConfirmationService.confirm so components
 * can keep their `const ok = await confirmDelete(...)` shape after the
 * window.confirm() -> themed p-confirmdialog swap.
 *
 * Usage:
 *   const ok = await confirmDelete(this.confirmation, {
 *     header: 'Delete company',
 *     message: `Delete "${company.name}"? This cannot be undone.`,
 *   });
 *   if (!ok) return;
 */
export interface ConfirmDeleteOptions {
  readonly header: string;
  readonly message: string;
  readonly acceptLabel?: string;
  readonly rejectLabel?: string;
}

export function confirmDelete(
  confirmation: ConfirmationService,
  options: ConfirmDeleteOptions
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmation.confirm({
      header: options.header,
      message: options.message,
      icon: 'fa-solid fa-triangle-exclamation',
      acceptLabel: options.acceptLabel ?? 'Delete',
      rejectLabel: options.rejectLabel ?? 'Cancel',
      acceptButtonProps: {
        severity: 'danger',
        size: 'small',
      },
      rejectButtonProps: {
        severity: 'secondary',
        outlined: true,
        size: 'small',
      },
      accept: () => resolve(true),
      reject: () => resolve(false),
    });
  });
}
