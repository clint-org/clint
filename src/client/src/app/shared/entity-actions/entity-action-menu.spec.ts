import { describe, expect, it, vi } from 'vitest';
import { buildEntityActionMenu } from './entity-action-menu';

describe('buildEntityActionMenu', () => {
  it('returns only extras when canEdit is false', () => {
    const extra = { label: 'View assets', icon: 'fa-solid fa-box', command: vi.fn() };
    const items = buildEntityActionMenu({
      canEdit: false,
      editLabel: 'Edit',
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      extras: [extra],
    });
    expect(items).toEqual([extra]);
  });

  it('appends Edit, separator and danger Delete when canEdit is true', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const items = buildEntityActionMenu({
      canEdit: true,
      editLabel: 'Edit details',
      onEdit,
      onDelete,
    });

    expect(items.map((i) => i.label ?? (i.separator ? 'SEP' : ''))).toEqual([
      'Edit details',
      'SEP',
      'Delete',
    ]);
    const del = items[2];
    expect(del.styleClass).toBe('row-actions-danger');

    items[0].command?.({} as never);
    items[2].command?.({} as never);
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('places extras before the edit/delete block', () => {
    const extra = { label: 'View trials', icon: 'fa-solid fa-flask', command: vi.fn() };
    const items = buildEntityActionMenu({
      canEdit: true,
      editLabel: 'Edit',
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      extras: [extra],
    });
    expect(items[0]).toBe(extra);
    expect(items[1].label).toBe('Edit');
  });
});
