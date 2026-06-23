import { NAV_ICONS } from '../../shared/constants/nav-icons';

/**
 * Section IDs the sidebar emits via `sectionClick`. Keep in sync with the
 * `Section` union in `app-shell.component.ts` and the `NAV_SECTIONS` array
 * below.
 */
export type SidebarSectionId = 'landscape' | 'intelligence' | 'manage' | 'settings';

export interface NavItem {
  label: string;
  route: string;
  icon?: string;
  children?: NavItem[];
  /**
   * When true, the item is hidden from non-owners. Used for owner-only space
   * settings (General, Members, Fields, Audit log); the route is also guarded
   * by `spaceOwnerGuard` / `auditSpaceGuard` so a deep-link is denied too.
   */
  ownerOnly?: boolean;
}

export interface NavSection {
  id: SidebarSectionId;
  label: string;
  items: NavItem[];
  bottom?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'landscape',
    label: 'Landscape',
    items: [
      { label: 'Home', route: '', icon: NAV_ICONS['home'] },
      { label: 'Timeline', route: 'timeline', icon: NAV_ICONS['timeline'] },
      {
        label: 'Bullseye',
        route: 'bullseye',
        icon: NAV_ICONS['bullseye'],
      },
      {
        label: 'Heatmap',
        route: 'heatmap',
        icon: NAV_ICONS['heatmap'],
      },
      { label: 'Future Catalysts', route: 'catalysts', icon: NAV_ICONS['catalysts'] },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { label: 'Space', route: 'manage/engagement', icon: NAV_ICONS['engagement'] },
      {
        label: 'Intelligence Feed',
        route: 'intelligence',
        icon: NAV_ICONS['intelligence-feed'],
      },
      { label: 'Materials', route: 'materials', icon: NAV_ICONS['materials'] },
      { label: 'Events', route: 'events', icon: NAV_ICONS['events'] },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { label: 'Companies', route: 'manage/companies', icon: NAV_ICONS['companies'] },
      { label: 'Assets', route: 'manage/assets', icon: NAV_ICONS['assets'] },
      { label: 'Trials', route: 'manage/trials', icon: NAV_ICONS['trials'] },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    bottom: true,
    items: [
      { label: 'General', route: 'settings/general', icon: NAV_ICONS['general'], ownerOnly: true },
      { label: 'Members', route: 'settings/members', icon: NAV_ICONS['members'], ownerOnly: true },
      { label: 'Fields', route: 'settings/fields', icon: NAV_ICONS['fields'], ownerOnly: true },
      // Reference settings: read-only, visible to all space roles.
      { label: 'Taxonomies', route: 'settings/taxonomies', icon: NAV_ICONS['taxonomies'] },
      { label: 'Marker Types', route: 'settings/marker-types', icon: NAV_ICONS['marker-types'] },
      {
        label: 'Audit log',
        route: 'settings/audit-log',
        icon: NAV_ICONS['audit-log'],
        ownerOnly: true,
      },
    ],
  },
];

export const ORG_ONLY_SECTIONS: NavSection[] = [];

/**
 * Filter the nav sections for the current space role. Pure (no Angular deps)
 * so it can be unit-tested directly:
 * - non-editors lose the `manage` section entirely,
 * - non-owners lose owner-only items (General, Members, Fields, Audit log)
 *   but keep the reference items (Taxonomies, Marker Types). A section with
 *   only reference items left is kept, not dropped.
 */
export function filterNavSections(
  sections: NavSection[],
  canEdit: boolean,
  isOwner: boolean
): NavSection[] {
  return sections
    .filter((section) => canEdit || section.id !== 'manage')
    .map((section) => {
      if (isOwner || !section.items.some((item) => item.ownerOnly)) {
        return section;
      }
      return { ...section, items: section.items.filter((item) => !item.ownerOnly) };
    })
    .filter((section) => section.items.length > 0);
}
