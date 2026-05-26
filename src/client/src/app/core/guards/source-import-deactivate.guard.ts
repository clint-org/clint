import { CanDeactivateFn } from '@angular/router';

export interface HasUnsavedImport {
  hasUnsavedChanges(): boolean;
}

export const sourceImportDeactivateGuard: CanDeactivateFn<HasUnsavedImport> = (component) => {
  if (component.hasUnsavedChanges()) {
    return window.confirm('Discard import? Unsaved proposals will be lost.');
  }
  return true;
};
