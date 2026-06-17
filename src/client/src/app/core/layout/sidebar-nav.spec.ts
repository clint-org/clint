import { describe, it, expect } from 'vitest';
import { filterNavSections } from './sidebar-nav';

// Minimal fixtures mirroring the shape of NAV_SECTIONS. We construct our own
// rather than import the private constant so the test pins the filtering
// contract, not the exact production nav.
const sections = [
  {
    id: 'manage' as const,
    label: 'Manage',
    items: [
      { label: 'Companies', route: 'manage/companies' },
      { label: 'Assets', route: 'manage/assets' },
    ],
  },
  {
    id: 'settings' as const,
    label: 'Settings',
    items: [
      { label: 'General', route: 'settings/general', ownerOnly: true },
      { label: 'Members', route: 'settings/members', ownerOnly: true },
      { label: 'Taxonomies', route: 'settings/taxonomies' },
      { label: 'Marker Types', route: 'settings/marker-types' },
      { label: 'Audit log', route: 'settings/audit-log', ownerOnly: true },
    ],
  },
];

function settingsRoutes(result: ReturnType<typeof filterNavSections>): string[] {
  return result.find((s) => s.id === 'settings')?.items.map((i) => i.route) ?? [];
}

describe('filterNavSections', () => {
  it('owner sees every section and every settings item', () => {
    const result = filterNavSections(sections, true, true);
    expect(result.map((s) => s.id)).toEqual(['manage', 'settings']);
    expect(settingsRoutes(result)).toEqual([
      'settings/general',
      'settings/members',
      'settings/taxonomies',
      'settings/marker-types',
      'settings/audit-log',
    ]);
  });

  it('editor (non-owner) keeps manage but loses owner-only settings items', () => {
    const result = filterNavSections(sections, true, false);
    expect(result.map((s) => s.id)).toEqual(['manage', 'settings']);
    expect(settingsRoutes(result)).toEqual(['settings/taxonomies', 'settings/marker-types']);
  });

  it('viewer (non-editor, non-owner) drops manage and keeps only reference settings', () => {
    const result = filterNavSections(sections, false, false);
    expect(result.map((s) => s.id)).toEqual(['settings']);
    expect(settingsRoutes(result)).toEqual(['settings/taxonomies', 'settings/marker-types']);
  });

  it('keeps the settings section when only reference items remain (does not drop it)', () => {
    const result = filterNavSections(sections, false, false);
    expect(result.some((s) => s.id === 'settings')).toBe(true);
  });

  it('drops a section that becomes empty after owner-only filtering', () => {
    const ownerOnlySection = [
      {
        id: 'settings' as const,
        label: 'Settings',
        items: [{ label: 'General', route: 'settings/general', ownerOnly: true }],
      },
    ];
    const result = filterNavSections(ownerOnlySection, true, false);
    expect(result).toEqual([]);
  });

  it('does not mutate the input sections', () => {
    const snapshot = JSON.stringify(sections);
    filterNavSections(sections, false, false);
    expect(JSON.stringify(sections)).toEqual(snapshot);
  });
});
