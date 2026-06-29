import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, filterNavSections } from './sidebar-nav';

const ids = (sections: ReturnType<typeof filterNavSections>) => sections.map((s) => s.id);
const settingsItems = (sections: ReturnType<typeof filterNavSections>) =>
  sections.find((s) => s.id === 'settings')?.items.map((i) => i.route) ?? [];
const intelligenceItems = (sections: ReturnType<typeof filterNavSections>) =>
  sections.find((s) => s.id === 'intelligence')?.items.map((i) => i.route) ?? [];

describe('filterNavSections role gating', () => {
  it('viewer: keeps profiles + reference, drops settings entirely', () => {
    const out = filterNavSections(NAV_SECTIONS, false, false, true);
    expect(ids(out)).toContain('profiles');
    expect(ids(out)).toContain('reference');
    expect(ids(out)).not.toContain('settings');
  });

  it('editor: keeps profiles + reference + taxonomies settings (marker-types de-routed), no owner items', () => {
    const out = filterNavSections(NAV_SECTIONS, true, false, true);
    expect(ids(out)).toContain('profiles');
    expect(settingsItems(out)).toEqual(['settings/taxonomies']);
  });

  it('owner: keeps everything', () => {
    const out = filterNavSections(NAV_SECTIONS, true, true, true);
    expect(settingsItems(out)).toEqual(
      expect.arrayContaining([
        'settings/general',
        'settings/members',
        'settings/fields',
        'settings/taxonomies',
        'settings/audit-log',
      ])
    );
  });

  it('reference group is visible to all roles', () => {
    for (const [canEdit, isOwner] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      expect(ids(filterNavSections(NAV_SECTIONS, canEdit, isOwner, true))).toContain('reference');
    }
  });

  it('does not mutate the input sections', () => {
    const before = NAV_SECTIONS.map((s) => s.items.length);
    filterNavSections(NAV_SECTIONS, false, false, true);
    expect(NAV_SECTIONS.map((s) => s.items.length)).toEqual(before);
  });
});

describe('Intelligence section ordering and engagement gating', () => {
  it('orders Feed first, then Engagement, then Activity, then Materials (when engagement exists)', () => {
    const out = filterNavSections(NAV_SECTIONS, true, true, true);
    expect(intelligenceItems(out)).toEqual([
      'intelligence',
      'profiles/engagement',
      'activity',
      'materials',
    ]);
  });

  it('hides the Engagement item from every role when no engagement exists', () => {
    for (const [canEdit, isOwner] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      const out = filterNavSections(NAV_SECTIONS, canEdit, isOwner, false);
      expect(intelligenceItems(out)).toEqual(['intelligence', 'activity', 'materials']);
      expect(intelligenceItems(out)).not.toContain('profiles/engagement');
    }
  });

  it('keeps the rest of the Intelligence section when engagement is hidden', () => {
    const out = filterNavSections(NAV_SECTIONS, false, false, false);
    expect(ids(out)).toContain('intelligence');
  });
});
