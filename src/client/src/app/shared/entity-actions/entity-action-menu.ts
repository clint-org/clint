import { MenuItem } from 'primeng/api';

export interface EntityActionMenuOptions {
  /** When false, Edit and Delete are omitted (viewer role). */
  readonly canEdit: boolean;
  /** Label for the edit item, e.g. 'Edit' (grid) or 'Edit details' (detail). */
  readonly editLabel: string;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  /** Entity-specific navigation items rendered before the edit/delete block. */
  readonly extras?: MenuItem[];
}

/**
 * Build the shared overflow-menu item list used by both an entity's grid row
 * and its detail-page header. Keeps the two surfaces byte-for-byte identical.
 * Destructive item carries `row-actions-danger` so the shared CSS colors it red.
 */
export function buildEntityActionMenu(opts: EntityActionMenuOptions): MenuItem[] {
  const items: MenuItem[] = [...(opts.extras ?? [])];
  if (!opts.canEdit) return items;
  items.push(
    { label: opts.editLabel, icon: 'fa-solid fa-pen', command: () => opts.onEdit() },
    { separator: true },
    {
      label: 'Delete',
      icon: 'fa-solid fa-trash',
      styleClass: 'row-actions-danger',
      command: () => opts.onDelete(),
    }
  );
  return items;
}
