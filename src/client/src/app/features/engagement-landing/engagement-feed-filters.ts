/**
 * Scope chips for the "Latest from <agency>" feed on the engagement landing.
 *
 * The chip set is FIXED (not data-gated): every entity scope renders in a
 * deterministic order regardless of how many posts each has, so the Asset
 * filter is always present and the row matches the always-on entity filters on
 * the landscape filter bar. Clicking a zero-count chip falls through to the
 * existing "No posts in this category" empty state.
 */
import {
  ENTITY_TYPE_LABEL,
  IntelligenceEntityType,
} from '../../core/models/primary-intelligence.model';
import { ENTITY_TYPE_ICON } from '../../shared/constants/nav-icons';

export interface FeedFilter {
  key: 'all' | IntelligenceEntityType;
  label: string;
  count: number;
  /** Nav-rail icon class for the entity scope; absent on the "All" chip. */
  icon?: string;
}

/** Fixed entity-scope order for the feed chips: space, company, asset, trial. */
const FEED_FILTER_ORDER: readonly IntelligenceEntityType[] = [
  'space',
  'company',
  'product',
  'trial',
];

/** Build the fixed scope-chip set with per-scope counts derived from the rows. */
export function buildFeedFilters(
  rows: readonly { entity_type: IntelligenceEntityType }[]
): FeedFilter[] {
  const counts = new Map<IntelligenceEntityType, number>();
  for (const r of rows) {
    counts.set(r.entity_type, (counts.get(r.entity_type) ?? 0) + 1);
  }
  const out: FeedFilter[] = [{ key: 'all', label: 'All', count: rows.length }];
  for (const type of FEED_FILTER_ORDER) {
    out.push({
      key: type,
      label: ENTITY_TYPE_LABEL[type] ?? type,
      count: counts.get(type) ?? 0,
      icon: ENTITY_TYPE_ICON[type],
    });
  }
  return out;
}
