import { NAV_ICONS } from '../../shared/constants/nav-icons';

/**
 * Section IDs the sidebar emits via `sectionClick`. Keep in sync with the
 * `Section` union in `app-shell.component.ts` and the `NAV_SECTIONS` array
 * below.
 */
export type SidebarSectionId = 'landscape' | 'intelligence' | 'profiles' | 'settings' | 'reference';

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
  /**
   * When true, the item is hidden from non-editors (viewers). Used for the
   * reference-settings management pages (Taxonomies); the route
   * is also guarded by `editGuard` so a deep-link is denied too. Viewers get
   * the read-only guides in the Reference group instead.
   */
  editorOnly?: boolean;
  /**
   * When true, the item is hidden for every role until the current space has
   * an engagement write-up (published or draft). Used for the Engagement item:
   * with no write-up there is nothing to show, and editors can still author
   * the first one from the Intelligence Feed ("Publish intelligence" -> Space).
   */
  requiresEngagement?: boolean;
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
      { label: 'Future Events', route: 'future-events', icon: NAV_ICONS['catalysts'] },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      {
        label: 'Intelligence Feed',
        route: 'intelligence',
        icon: NAV_ICONS['intelligence-feed'],
      },
      {
        label: 'Engagement',
        route: 'profiles/engagement',
        icon: NAV_ICONS['engagement'],
        requiresEngagement: true,
      },
      { label: 'Materials', route: 'materials', icon: NAV_ICONS['materials'] },
    ],
  },
  {
    id: 'profiles',
    label: 'Profiles',
    items: [
      { label: 'Companies', route: 'profiles/companies', icon: NAV_ICONS['companies'] },
      { label: 'Assets', route: 'profiles/assets', icon: NAV_ICONS['assets'] },
      { label: 'Trials', route: 'profiles/trials', icon: NAV_ICONS['trials'] },
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
      {
        label: 'Taxonomies',
        route: 'settings/taxonomies',
        icon: NAV_ICONS['taxonomies'],
        editorOnly: true,
      },
      {
        label: 'Audit log',
        route: 'settings/audit-log',
        icon: NAV_ICONS['audit-log'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    bottom: true,
    items: [
      { label: 'Taxonomies guide', route: 'help/taxonomies', icon: NAV_ICONS['taxonomies'] },
      { label: 'Event glyphs guide', route: 'help/markers', icon: NAV_ICONS['marker-types'] },
      { label: 'Phases guide', route: 'help/phases', icon: NAV_ICONS['phases'] },
    ],
  },
];

export const ORG_ONLY_SECTIONS: NavSection[] = [];

/**
 * Filter the nav sections for the current space role. Pure (no Angular deps)
 * so it can be unit-tested directly:
 * - `ownerOnly` items (General, Members, Fields, Audit log) drop for non-owners,
 * - `editorOnly` items (Taxonomies management) drop for viewers,
 * - `requiresEngagement` items (Engagement) drop for every role when the space
 *   has no engagement write-up (`hasEngagement` false),
 * - the Profiles and Reference sections carry no flags, so they survive for all
 *   roles. A section left with no items is dropped.
 */
export function filterNavSections(
  sections: NavSection[],
  canEdit: boolean,
  isOwner: boolean,
  hasEngagement: boolean
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (isOwner || !item.ownerOnly) &&
          (canEdit || !item.editorOnly) &&
          (hasEngagement || !item.requiresEngagement)
      ),
    }))
    .filter((section) => section.items.length > 0);
}
