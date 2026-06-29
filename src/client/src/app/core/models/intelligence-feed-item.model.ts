import type { DatePrecision, FillStyle, InnerMark, MarkerShape } from './marker.model';
import type {
  IntelligenceEntityType,
  IntelligenceFeedRow,
  PrimaryIntelligenceLink,
} from './primary-intelligence.model';

/**
 * One row of the unified Intelligence feed (the /intelligence stream): published
 * briefs and all events interleaved by recency. `kind` discriminates the two
 * shapes. Mirrors the jsonb rows returned by `list_intelligence_feed`; field
 * names match the RPC keys byte-for-byte (the cast is not runtime-checked, so
 * the mapping is guarded by the integration + unit tests).
 */
export type FeedItem = BriefFeedItem | EventFeedItem;

interface FeedItemBase {
  id: string;
  space_id: string;
  /** Recency sort key: brief.updated_at or event.created_at. ISO string. */
  feed_ts: string;
  title: string;
}

export interface BriefFeedItem extends FeedItemBase {
  kind: 'brief';
  entity_type: IntelligenceEntityType;
  entity_id: string;
  entity_name: null;
  anchor_id: string;
  is_lead: boolean;
  summary_md: string;
  last_edited_by: string;
  state: string;
  links: Pick<
    PrimaryIntelligenceLink,
    'entity_type' | 'entity_id' | 'relationship_type' | 'gloss'
  >[];
  contributors: string[];
}

export interface EventFeedItem extends FeedItemBase {
  kind: 'event';
  /** 'product' for asset-anchored, else the anchor_type; 'space' has no entity_id. */
  entity_type: 'company' | 'product' | 'trial' | 'space';
  entity_id: string | null;
  entity_name: string | null;
  event_date: string;
  date_precision: DatePrecision;
  end_date: string | null;
  end_date_precision: DatePrecision;
  is_ongoing: boolean;
  projection: 'forecasted' | 'company' | 'primary' | 'actual';
  is_projected: boolean;
  significance: 'high' | 'low' | null;
  visibility: 'pinned' | 'hidden' | null;
  no_longer_expected: boolean;
  category_name: string;
  marker_shape: MarkerShape;
  marker_color: string;
  marker_inner_mark: InnerMark;
  marker_fill_style: FillStyle;
  anchor_type: 'space' | 'company' | 'asset' | 'trial';
  description: string | null;
}

export interface FeedResult {
  rows: FeedItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Narrows a feed row to the event shape. */
export function isEventItem(item: FeedItem): item is EventFeedItem {
  return item.kind === 'event';
}

/**
 * Adapts an `IntelligenceFeedRow` (from list_primary_intelligence /
 * list_draft_intelligence_for_space) into a `BriefFeedItem`, so brief-only
 * surfaces (the Drafts view) can feed the unified IntelligenceFeedComponent.
 * `feed_ts` is the brief's `updated_at`; `title` is the headline.
 */
export function briefRowToFeedItem(row: IntelligenceFeedRow): BriefFeedItem {
  return {
    kind: 'brief',
    id: row.id,
    space_id: row.space_id,
    feed_ts: row.updated_at,
    title: row.headline,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    entity_name: null,
    anchor_id: row.anchor_id,
    is_lead: row.is_lead,
    summary_md: row.summary_md,
    last_edited_by: row.last_edited_by,
    state: row.state,
    links: row.links,
    contributors: row.contributors,
  };
}
