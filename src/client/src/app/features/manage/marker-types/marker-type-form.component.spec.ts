import { describe, expect, it, vi } from 'vitest';

import { MarkerCategory } from '../../../core/models/marker.model';
import { createInlineCategory } from './marker-type-form.inline-category';

// The component itself is not constructed here: importing a templateUrl component
// into the plain-node unit runner triggers JIT compilation. Following the repo
// idiom (see engagement-landing.component.spec.ts), the inline-create behavior
// lives in a pure helper that the component delegates to, and we test that.

describe('createInlineCategory', () => {
  it('creates and returns the category for a valid name', async () => {
    const created: MarkerCategory = {
      id: 'cat-new',
      name: 'Manufacturing',
      space_id: 'space-1',
      display_order: 6,
      is_system: false,
      created_by: null,
      created_at: '',
      updated_at: '',
    };
    const create = vi.fn().mockResolvedValue(created);

    const result = await createInlineCategory({ create }, 'space-1', '  Manufacturing  ');

    expect(create).toHaveBeenCalledWith('space-1', 'Manufacturing');
    expect(result).toBe(created);
  });

  it('returns null and does not call create for a blank name', async () => {
    const create = vi.fn();

    const result = await createInlineCategory({ create }, 'space-1', '   ');

    expect(create).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
