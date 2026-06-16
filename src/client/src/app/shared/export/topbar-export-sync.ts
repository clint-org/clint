import type { WritableSignal } from '@angular/core';
import type { ExportAction } from './export-button.component';

export interface TopbarExportSync {
  /** Publish this page's current export actions to the topbar. */
  push(actions: ExportAction[]): void;
  /** Clear the topbar on destroy, but only if this page's actions are still current. */
  teardown(): void;
}

/**
 * Last-writer-wins guard for pages that publish export actions to the topbar.
 * On route switches the outgoing view can be destroyed after the incoming view
 * has already published (route animations overlap component lifetimes), so a
 * blind clear-on-destroy would wipe the new page's actions. teardown() only
 * clears when the topbar still holds the exact array this page pushed last.
 */
export function createTopbarExportSync(topbar: {
  exportActions: WritableSignal<ExportAction[]>;
}): TopbarExportSync {
  let last: ExportAction[] | null = null;
  return {
    push(actions: ExportAction[]): void {
      last = actions;
      topbar.exportActions.set(actions);
    },
    teardown(): void {
      if (topbar.exportActions() === last) {
        topbar.exportActions.set([]);
      }
    },
  };
}
