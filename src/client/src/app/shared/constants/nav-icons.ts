/** Canonical icon class for each navigable entity/page in the app. */
export const NAV_ICONS: Record<string, string> = {
  // Sections (icon rail)
  landscape: 'fa-solid fa-chart-line',
  intelligence: 'fa-solid fa-star',
  profiles: 'fa-solid fa-id-card',
  reference: 'fa-solid fa-book',
  settings: 'fa-solid fa-gear',

  // Landscape pages
  home: 'fa-solid fa-house',
  timeline: 'fa-solid fa-timeline',
  bullseye: 'fa-solid fa-bullseye',
  'heatmap': 'fa-solid fa-table-cells',

  // Intelligence pages
  engagement: 'fa-solid fa-handshake',
  events: 'fa-solid fa-calendar-day',
  catalysts: 'fa-solid fa-bolt',
  'intelligence-feed': 'fa-solid fa-newspaper',
  materials: 'fa-solid fa-folder-open',

  // Profiles pages
  companies: 'fa-solid fa-building',
  assets: 'fa-solid fa-capsules',
  trials: 'fa-solid fa-flask',

  // Settings pages
  general: 'fa-solid fa-gear',
  members: 'fa-solid fa-users',
  fields: 'fa-solid fa-table-columns',
  taxonomies: 'fa-solid fa-tags',
  'marker-types': 'fa-solid fa-shapes',
  'audit-log': 'fa-solid fa-clock-rotate-left',
  phases: 'fa-solid fa-layer-group',
};

/**
 * Canonical icon class per intelligence/entity scope type, reusing the same
 * glyphs as the nav rail so trial/company/asset/space read identically wherever
 * they are surfaced (scope filters, inventory counts, feed kind labels).
 * Keyed by `IntelligenceEntityType` ('product' is the Asset scope).
 */
export const ENTITY_TYPE_ICON: Record<string, string> = {
  trial: NAV_ICONS['trials'],
  company: NAV_ICONS['companies'],
  product: NAV_ICONS['assets'],
  space: NAV_ICONS['engagement'],
};
