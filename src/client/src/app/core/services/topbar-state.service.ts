// src/client/src/app/core/services/topbar-state.service.ts
import { Injectable, signal } from '@angular/core';
import { MenuItem } from 'primeng/api';

/**
 * PrimeNG p-button severity union. Mirrors the values accepted by the
 * `severity` input on `primeng/button`. Keep in sync if PrimeNG widens it.
 */
export type TopbarActionSeverity =
  | 'success'
  | 'info'
  | 'warn'
  | 'danger'
  | 'help'
  | 'primary'
  | 'secondary'
  | 'contrast';

export interface TopbarAction {
  label: string;
  icon: string;
  severity?: TopbarActionSeverity;
  outlined?: boolean;
  text?: boolean;
  callback: () => void;
}

@Injectable({ providedIn: 'root' })
export class TopbarStateService {
  /** Page title shown in topbar for list pages (e.g., "Events", "Companies"). */
  readonly title = signal('');

  /** Section eyebrow for detail pages (e.g., "Novo Nordisk"). */
  readonly entityContext = signal('');

  /** Entity title for detail pages (e.g., "TRIM-1"). */
  readonly entityTitle = signal('');

  /** Record count displayed beside the title (e.g., "247"). */
  readonly recordCount = signal('');

  /** Action buttons rendered in the topbar-actions area. */
  readonly actions = signal<TopbarAction[]>([]);

  /**
   * Entity edit/delete (+ nav) rendered as a shared overflow kebab on detail
   * pages -- the same `app-row-actions` idiom used in manage grid rows.
   */
  readonly overflowActions = signal<MenuItem[]>([]);

  /** Reset all page-specific state (call from page OnDestroy). */
  clear(): void {
    this.title.set('');
    this.entityContext.set('');
    this.entityTitle.set('');
    this.recordCount.set('');
    this.actions.set([]);
    this.overflowActions.set([]);
  }
}
