// src/client/src/app/core/services/topbar-state.service.ts
import { Injectable, signal } from '@angular/core';

export interface TopbarAction {
  label: string;
  icon: string;
  severity?: string;
  outlined?: boolean;
  text?: boolean;
  callback: () => void;
}

export interface TopbarSubTab {
  label: string;
  value: string;
  active: boolean;
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

  /** Dimension sub-tabs rendered after the main section tabs (e.g., Bullseye dimensions, Positioning groupings). */
  readonly subTabs = signal<TopbarSubTab[]>([]);

  /** Callback invoked when a sub-tab is clicked. Set by the feature that owns the sub-tabs. */
  readonly onSubTabClick = signal<((value: string) => void) | null>(null);

  /** Reset all page-specific state (call from page OnDestroy). */
  clear(): void {
    this.title.set('');
    this.entityContext.set('');
    this.entityTitle.set('');
    this.recordCount.set('');
    this.actions.set([]);
    this.subTabs.set([]);
    this.onSubTabClick.set(null);
  }
}
