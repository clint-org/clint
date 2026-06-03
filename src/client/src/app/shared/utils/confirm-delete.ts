import { ConfirmationService } from 'primeng/api';

/**
 * Promise-shaped wrapper around the destructive-confirm flow. Two routes:
 *
 *   1. Plain confirm (legacy). When the caller passes only `header` /
 *      `message` / `details`, delegate to PrimeNG's global
 *      `<p-confirmdialog />` via `ConfirmationService.confirm()`. This
 *      preserves the original `const ok = await confirmDelete(...)` shape
 *      that pre-cascade-safety call sites rely on.
 *
 *   2. Count-aware confirm with type-the-name gate. When the caller passes
 *      `counts` or `typedConfirmationValue`, the cascade-safety dialog
 *      (mounted once at app root) opens with a count breakdown and an
 *      input field that the user must fill in exactly before the Confirm
 *      button enables. PrimeNG's `<p-confirmdialog />` has no native
 *      input-gate, so this dialog is a dedicated standalone component;
 *      it self-registers an opener via `_registerConfirmDeleteOpener` at
 *      construction so `confirmDelete()` can reach it without callers
 *      having to inject it directly.
 *
 * Examples:
 *
 *   // Plain confirm (legacy).
 *   const ok = await confirmDelete(this.confirmation, {
 *     header: 'Delete company',
 *     message: `Delete "${company.name}"? This cannot be undone.`,
 *   });
 *
 *   // Count-aware + type-the-name (cascade-safety, T10/T11/T12).
 *   const counts = await this.companyService.previewDelete(company.id);
 *   const ok = await confirmDelete(this.confirmation, {
 *     header: 'Delete company',
 *     entityLabel: company.name,
 *     message: 'This will permanently delete:',
 *     counts,
 *     typedConfirmationValue: company.name,
 *   });
 */

/** jsonb payload returned by `preview_*_delete()` RPCs. */
export type DeleteCountBreakdown = Readonly<Record<string, number>>;

export interface ConfirmDeleteOptions {
  readonly header: string;
  /** Default Confirm button label is "Delete". Override sparingly. */
  readonly acceptLabel?: string;
  /** Default Cancel button label is "Cancel". Override sparingly. */
  readonly rejectLabel?: string;
  /**
   * The thing being deleted ("Eli Lilly", "Phase 3 readout"). Rendered in
   * the dialog title row and used as the default `typedConfirmationValue`
   * when not otherwise set. For unnamed-item deletes (single marker, note,
   * event), leave undefined and pass `typedConfirmationValue: 'delete'`.
   */
  readonly entityLabel?: string;
  /**
   * Lead-in line above the count breakdown. Defaults to a generic prompt.
   * In the count-aware dialog this is rendered as the main message; in the
   * legacy dialog it is rendered alone (no counts to follow).
   */
  readonly message?: string;
  /**
   * Optional follow-up sentence describing cascade behavior or anything
   * the user might assume is lost but isn't. In the legacy dialog it is
   * appended to `message`; in the count-aware dialog it renders below the
   * count breakdown.
   */
  readonly details?: string;
  /** Count breakdown to render as a table. Zero values are suppressed. */
  readonly counts?: DeleteCountBreakdown;
  /**
   * Whether the dialog requires the user to type a confirmation string
   * before the Confirm button enables. Defaults to true whenever
   * `typedConfirmationValue` or `entityLabel` is set (i.e. whenever the
   * dialog knows what string to require). Pass false to explicitly skip
   * the type-the-name gate even when an `entityLabel` is provided.
   */
  readonly requireTypedConfirmation?: boolean;
  /**
   * The exact string the user must type to enable Confirm. Defaults to
   * `entityLabel` if not set. For unnamed-item deletes pass the literal
   * `'delete'`.
   */
  readonly typedConfirmationValue?: string;
}

/**
 * Internal: the opener callable that `ConfirmDeleteDialogComponent`
 * registers with this module at construction. Lives at module scope so
 * the helper can reach the dialog without callers having to inject it.
 */
type ConfirmDeleteOpener = (opts: ConfirmDeleteOptions) => Promise<boolean>;
let registeredOpener: ConfirmDeleteOpener | null = null;

/**
 * Internal: registration hook called by `ConfirmDeleteDialogComponent`
 * during construction. Not part of the public API; do not call from
 * feature code. Exported so the dialog component (a different file) can
 * invoke it without taking a circular import on this util.
 */
export function _registerConfirmDeleteOpener(opener: ConfirmDeleteOpener | null): void {
  registeredOpener = opener;
}

/**
 * Internal helper for tests: read the currently-registered opener. Lets
 * the spec swap in a mock opener without standing up the real dialog
 * component.
 */
export function _getRegisteredConfirmDeleteOpener(): ConfirmDeleteOpener | null {
  return registeredOpener;
}

/** True when the options require the count-aware dialog. */
function needsRichDialog(opts: ConfirmDeleteOptions): boolean {
  if (opts.counts !== undefined) return true;
  if (opts.typedConfirmationValue !== undefined) return true;
  if (opts.requireTypedConfirmation === true) return true;
  return false;
}

/**
 * Resolve the literal string the user must type into the confirmation
 * input. Returns null when no typed gate applies (legacy plain confirm).
 *
 * Precedence:
 *   1. Explicit `typedConfirmationValue` wins.
 *   2. Otherwise default to `entityLabel` when present.
 *   3. Otherwise, if `requireTypedConfirmation` is forced true, default
 *      to the literal 'delete' (covers unnamed-item paths that forgot to
 *      set a value).
 *   4. Otherwise null (no typed gate).
 *
 * Explicit `requireTypedConfirmation: false` short-circuits the gate even
 * when `entityLabel` is set; this is the escape hatch for surfaces that
 * want counts but not friction.
 */
export function resolveTypedConfirmationValue(opts: ConfirmDeleteOptions): string | null {
  if (opts.requireTypedConfirmation === false) return null;
  if (opts.typedConfirmationValue !== undefined) return opts.typedConfirmationValue;
  if (opts.entityLabel !== undefined && opts.entityLabel.length > 0) return opts.entityLabel;
  if (opts.requireTypedConfirmation === true) return 'delete';
  return null;
}

/**
 * Human-readable label for a count-breakdown key. Sentence-case, with
 * underscores replaced by spaces, and a few cascade-safety-specific keys
 * hand-tuned for clarity. The two marker keys disambiguate the asymmetric
 * marker-orphan cleanup path: `markers_removed_entirely` is the count of
 * markers whose every assignment lives inside the deletion scope (so the
 * orphan trigger removes them); `markers_unlinked_only` is the count of
 * markers that survive in the space because they still have assignments
 * to other entities outside the scope.
 */
export function humanizeCountKey(key: string): string {
  switch (key) {
    case 'markers_removed_entirely':
      return 'Markers removed entirely';
    case 'markers_unlinked_only':
      return 'Markers unlinked only';
    case 'primary_intelligence':
      return 'Intelligence reads';
    case 'primary_intelligence_links':
      return 'Intelligence links';
    case 'marker_assignments':
      return 'Marker assignments';
    case 'marker_notifications':
      return 'Marker notifications';
    case 'products':
      // The data-model key stays 'products'; the user-facing noun is 'asset'.
      return 'Assets';
    default: {
      const spaced = key.replace(/_/g, ' ').trim();
      if (spaced.length === 0) return key;
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
  }
}

export interface FormattedCountRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/**
 * Format a count breakdown for display. Suppresses zero-valued rows
 * (nothing to delete in that category is noise, not signal). Preserves
 * insertion order from the source jsonb so the dialog reads the way the
 * RPC author ordered it.
 */
export function formatCountBreakdown(counts: DeleteCountBreakdown): FormattedCountRow[] {
  const rows: FormattedCountRow[] = [];
  for (const key of Object.keys(counts)) {
    const value = counts[key];
    if (typeof value !== 'number' || value <= 0) continue;
    rows.push({ key, label: humanizeCountKey(key), value });
  }
  return rows;
}

export function confirmDelete(
  confirmation: ConfirmationService,
  options: ConfirmDeleteOptions
): Promise<boolean> {
  if (needsRichDialog(options) && registeredOpener !== null) {
    return registeredOpener(options);
  }

  // Legacy plain confirm path. Preserves the prior call shape used by
  // every existing surface; T12 migrates each call site to the rich path
  // as preview RPCs land.
  return new Promise((resolve) => {
    const merged = options.details ? `${options.message ?? ''} ${options.details}`.trim() : (options.message ?? '');
    confirmation.confirm({
      header: options.header,
      message: merged,
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
