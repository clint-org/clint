import { describe, expect, it } from 'vitest';

import { MarkerCategory, MarkerType } from '../../../core/models/marker.model';
import {
  buildTypeCounts,
  categoriesSorted,
  isSystemTaxonomyRow,
  taxonomyDuplicateNameMessage,
} from './taxonomy-tabs.logic';

function cat(overrides: Partial<MarkerCategory>): MarkerCategory {
  return {
    id: 'c',
    space_id: 'space-1',
    name: 'Cat',
    display_order: 0,
    is_system: false,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('isSystemTaxonomyRow', () => {
  it('flags rows marked is_system', () => {
    expect(isSystemTaxonomyRow({ is_system: true, space_id: 'space-1' })).toBe(true);
  });

  it('flags rows with no space_id even when is_system is false', () => {
    expect(isSystemTaxonomyRow({ is_system: false, space_id: null })).toBe(true);
    expect(isSystemTaxonomyRow({ space_id: undefined })).toBe(true);
  });

  it('treats space-scoped custom rows as editable', () => {
    expect(isSystemTaxonomyRow({ is_system: false, space_id: 'space-1' })).toBe(false);
  });
});

describe('taxonomyDuplicateNameMessage', () => {
  it('returns a friendly message for a 23505 unique violation', () => {
    const msg = taxonomyDuplicateNameMessage({ code: '23505' }, 'event type');
    expect(msg).toBe(
      'An event type with this name already exists in this space. Choose a different name.'
    );
  });

  it('uses the entity label in the duplicate message', () => {
    const msg = taxonomyDuplicateNameMessage({ code: '23505' }, 'event category');
    expect(msg).toContain('event category');
  });

  it('falls back to the error message for non-unique errors', () => {
    const msg = taxonomyDuplicateNameMessage({ code: '500', message: 'boom' }, 'event type');
    expect(msg).toBe('boom');
  });

  it('falls back to generic copy when no message is present', () => {
    const msg = taxonomyDuplicateNameMessage({}, 'event type');
    expect(msg).toBe('Could not save event type. Check your connection and try again.');
  });
});

describe('categoriesSorted', () => {
  it('sorts system rows first, then by display order within each group', () => {
    const categories = [
      cat({ id: 'custom-b', is_system: false, display_order: 7 }),
      cat({ id: 'sys-2', is_system: true, display_order: 2 }),
      cat({ id: 'custom-a', is_system: false, display_order: 6 }),
      cat({ id: 'sys-1', is_system: true, display_order: 1 }),
    ];
    expect(categoriesSorted(categories).map((c) => c.id)).toEqual([
      'sys-1',
      'sys-2',
      'custom-a',
      'custom-b',
    ]);
  });
});

describe('buildTypeCounts', () => {
  it('counts event types per category_id', () => {
    const types = [
      { category_id: 'c1' },
      { category_id: 'c1' },
      { category_id: 'c2' },
    ] as MarkerType[];
    const counts = buildTypeCounts(types);
    expect(counts.get('c1')).toBe(2);
    expect(counts.get('c2')).toBe(1);
    expect(counts.get('c3')).toBeUndefined();
  });
});
