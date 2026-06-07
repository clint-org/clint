import { ConfirmationService, MessageService } from 'primeng/api';
import {
  ConfirmDeleteOptions,
  DeleteCountBreakdown,
  confirmDelete,
} from '../utils/confirm-delete';

export interface RunEntityDeleteOptions {
  readonly confirmation: ConfirmationService;
  readonly messageService: MessageService;
  /** Confirm dialog config minus `counts` (filled from `preview` when present). */
  readonly confirm: Omit<ConfirmDeleteOptions, 'counts'>;
  /** Optional cascade-count preview run before the dialog opens. */
  readonly preview?: () => Promise<DeleteCountBreakdown>;
  readonly delete: () => Promise<void>;
  readonly successSummary: string;
  /** Runs only after a successful delete (reload list, or navigate to parent). */
  readonly onSuccess: () => void | Promise<void>;
  /** Fallback error message when the thrown error has no message. */
  readonly errorFallback?: string;
}

/**
 * Shared destructive flow for every manage entity: optional cascade preview,
 * typed-confirmation dialog, delete, success toast, then `onSuccess`. On
 * failure it surfaces an error toast and leaves `onSuccess` uncalled. Used by
 * both grid rows (onSuccess = reload) and detail headers (onSuccess = navigate).
 */
export async function runEntityDelete(opts: RunEntityDeleteOptions): Promise<void> {
  let counts: DeleteCountBreakdown | undefined;
  if (opts.preview) {
    try {
      counts = await opts.preview();
    } catch (err) {
      opts.messageService.add({
        severity: 'error',
        summary: 'Delete preview failed',
        detail: err instanceof Error ? err.message : (opts.errorFallback ?? 'Try again.'),
        life: 4000,
      });
      return;
    }
  }

  const ok = await confirmDelete(opts.confirmation, { ...opts.confirm, counts });
  if (!ok) return;

  try {
    await opts.delete();
    opts.messageService.add({ severity: 'success', summary: opts.successSummary, life: 3000 });
    await opts.onSuccess();
  } catch (err) {
    opts.messageService.add({
      severity: 'error',
      summary: 'Delete failed',
      detail: err instanceof Error ? err.message : (opts.errorFallback ?? 'Try again.'),
      life: 4000,
    });
  }
}
