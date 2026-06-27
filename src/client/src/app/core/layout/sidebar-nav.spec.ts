import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, filterNavSections } from './sidebar-nav';

const ids = (sections: ReturnType<typeof filterNavSections>) => sections.map((s) => s.id);
const settingsItems = (sections: ReturnType<typeof filterNavSections>) =>
  sections.find((s) => s.id === 'settings')?.items.map((i) => i.route) ?? [];

describe('filterNavSections role gating', () => {
  it('viewer: keeps profiles + reference, drops settings entirely', () => {
    const out = filterNavSections(NAV_SECTIONS, false, false);
    expect(ids(out)).toContain('profiles');
    expect(ids(out)).toContain('reference');
    expect(ids(out)).not.toContain('settings');
  });

  it('editor: keeps profiles + reference + taxonomies/marker-types settings, no owner items', () => {
    const out = filterNavSections(NAV_SECTIONS, true, false);
    expect(ids(out)).toContain('profiles');
    expect(settingsItems(out)).toEqual(['settings/taxonomies', 'settings/marker-types']);
  });

  it('owner: keeps everything', () => {
    const out = filterNavSections(NAV_SECTIONS, true, true);
    expect(settingsItems(out)).toEqual(
      expect.arrayContaining([
        'settings/general',
        'settings/members',
        'settings/fields',
        'settings/taxonomies',
        'settings/marker-types',
        'settings/audit-log',
      ])
    );
  });

  it('reference group is visible to all roles', () => {
    for (const [canEdit, isOwner] of [[false, false], [true, false], [true, true]] as const) {
      expect(ids(filterNavSections(NAV_SECTIONS, canEdit, isOwner))).toContain('reference');
    }
  });

  it('does not mutate the input sections', () => {
    const before = NAV_SECTIONS.map((s) => s.items.length);
    filterNavSections(NAV_SECTIONS, false, false);
    expect(NAV_SECTIONS.map((s) => s.items.length)).toEqual(before);
  });
});
