import { describe, expect, it } from 'vitest';

import { MarkerCategory, MarkerType } from '../../../core/models/marker.model';
import {
  buildTypeCounts,
  customCategoriesSorted,
  systemCategoriesSorted,
} from './marker-category-list.logic';

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

function type(categoryId: string): MarkerType {
  return { category_id: categoryId } as MarkerType;
}

describe('buildTypeCounts', () => {
  it('counts marker types per category_id', () => {
    const counts = buildTypeCounts([type('c1'), type('c1'), type('c2')]);
    expect(counts.get('c1')).toBe(2);
    expect(counts.get('c2')).toBe(1);
    expect(counts.get('c3')).toBeUndefined();
  });
});

describe('customCategoriesSorted', () => {
  it('excludes system categories and sorts by display_order', () => {
    const categories = [
      cat({ id: 's', is_system: true, display_order: 1 }),
      cat({ id: 'b', is_system: false, display_order: 7 }),
      cat({ id: 'a', is_system: false, display_order: 6 }),
    ];
    expect(customCategoriesSorted(categories).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('systemCategoriesSorted', () => {
  it('keeps only system categories sorted by display_order', () => {
    const categories = [
      cat({ id: 's2', is_system: true, display_order: 2 }),
      cat({ id: 'custom', is_system: false, display_order: 6 }),
      cat({ id: 's1', is_system: true, display_order: 1 }),
    ];
    expect(systemCategoriesSorted(categories).map((c) => c.id)).toEqual(['s1', 's2']);
  });
});
