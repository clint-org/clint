/** The event anchor kinds a marker can carry (mirrors events.anchor_type). */
export type MarkerEditAnchor = 'space' | 'company' | 'asset' | 'trial';

/**
 * Minimal anchor shape read off a catalyst/marker detail. Kept structural so
 * the helper does not couple to the full CatalystDetail intersection.
 */
export interface MarkerAnchorFields {
  anchor_type: MarkerEditAnchor;
  trial_id: string | null;
  asset_id: string | null;
  company_id: string | null;
}

/** Resolved edit anchor: a routable entity profile plus its id. */
export interface MarkerEditTarget {
  anchorType: Exclude<MarkerEditAnchor, 'space'>;
  anchorId: string;
}

const ANCHOR_SEGMENT: Record<MarkerEditTarget['anchorType'], string> = {
  company: 'companies',
  asset: 'assets',
  trial: 'trials',
};

/**
 * Resolve the entity a marker should be edited on, or null when there is no
 * routable destination. A marker is edited through the merged Event dialog on
 * its anchor entity's profile page (the page mounts entity-events-section,
 * which opens that dialog from the `?marker=<id>` deep link).
 *
 * Returns null for space-anchored markers (no entity profile) and for any
 * anchor whose id is missing -- callers hide the Edit affordance in that case
 * rather than offer a dead action. This replaces the legacy `trial_id`-only
 * gate that hid Edit for every asset/company-anchored marker.
 */
export function markerEditAnchor(
  catalyst: MarkerAnchorFields | null | undefined
): MarkerEditTarget | null {
  if (!catalyst) return null;
  switch (catalyst.anchor_type) {
    case 'trial':
      return catalyst.trial_id ? { anchorType: 'trial', anchorId: catalyst.trial_id } : null;
    case 'asset':
      return catalyst.asset_id ? { anchorType: 'asset', anchorId: catalyst.asset_id } : null;
    case 'company':
      return catalyst.company_id ? { anchorType: 'company', anchorId: catalyst.company_id } : null;
    default:
      return null;
  }
}

/** Route commands + query params, or null when context/anchor is incomplete. */
export interface MarkerEditRoute {
  commands: unknown[];
  queryParams: { marker: string };
}

/**
 * Build the router target that opens a marker's merged Event editor: the
 * marker's anchor-entity profile with `?marker=<markerId>`. The destination
 * page's entity-events-section reads that param and opens the dialog. Returns
 * null when tenant/space context is missing or the anchor is not routable.
 */
export function markerEditRoute(
  target: MarkerEditTarget | null,
  markerId: string,
  tenant: string,
  space: string
): MarkerEditRoute | null {
  if (!target || !markerId || !tenant || !space) return null;
  return {
    commands: ['/t', tenant, 's', space, 'profiles', ANCHOR_SEGMENT[target.anchorType], target.anchorId],
    queryParams: { marker: markerId },
  };
}
