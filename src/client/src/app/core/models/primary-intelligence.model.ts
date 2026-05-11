/**
 * Primary intelligence -- Stout's authored read on an entity in the
 * engagement (trial, marker, company, product, or the space itself).
 *
 * Mirrors the Postgres tables `primary_intelligence` and
 * `primary_intelligence_links`. The `*Detail` types match the jsonb
 * shape returned by `get_*_detail_with_intelligence()` and
 * `get_space_intelligence()`.
 */

export type IntelligenceEntityType = 'trial' | 'marker' | 'company' | 'product' | 'space';

export type IntelligenceLinkEntityType = Exclude<IntelligenceEntityType, 'space'>;

export type IntelligenceState = 'draft' | 'published' | 'archived' | 'withdrawn';

/** States that count as "a version" in the history panel (excludes draft). */
export type VersionState = Exclude<IntelligenceState, 'draft'>;

export interface PrimaryIntelligence {
  id: string;
  space_id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  state: IntelligenceState;
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
  publish_note: string | null;
  last_edited_by: string;
  created_at: string;
  updated_at: string;
}

export interface PrimaryIntelligenceLink {
  id?: string;
  entity_type: IntelligenceLinkEntityType;
  entity_id: string;
  /** Resolved name from the linked entity (trials.name, markers.title, etc.). Null if the row was deleted. */
  entity_name?: string | null;
  relationship_type: string;
  gloss: string | null;
  display_order: number;
}

/** Full payload returned by `build_intelligence_payload` (jsonb) */
export interface IntelligencePayload {
  record: PrimaryIntelligence;
  links: PrimaryIntelligenceLink[];
  contributors: string[];
}

/** Compact row used by the Referenced-in section. */
export interface ReferencedInRow {
  id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  state: IntelligenceState;
  headline: string;
  updated_at: string;
  last_edited_by: string;
  relationship_type: string | null;
  gloss: string | null;
}

/** Detail-page bundle returned by the get_*_with_intelligence RPCs. */
export interface IntelligenceDetailBundle {
  space_id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  published: IntelligencePayload | null;
  draft: IntelligencePayload | null;
  referenced_in: ReferencedInRow[];
}

/** Compact row used by Latest-from-Stout feed and the browse view. */
export interface IntelligenceFeedRow {
  id: string;
  space_id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  state: IntelligenceState;
  headline: string;
  thesis_md: string;
  last_edited_by: string;
  updated_at: string;
  links: Pick<
    PrimaryIntelligenceLink,
    'entity_type' | 'entity_id' | 'relationship_type' | 'gloss'
  >[];
  contributors: string[];
}

export interface IntelligenceFeedResult {
  rows: IntelligenceFeedRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpsertIntelligenceInput {
  id: string | null;
  space_id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
  state: IntelligenceState;
  change_note: string | null;
  links: PrimaryIntelligenceLink[];
}

export const RELATIONSHIP_OPTIONS: readonly string[] = [
  'Competitor',
  'Same class',
  'Predecessor',
  'Combination',
  'Future window',
  'Partner',
];

export const ENTITY_TYPE_LABEL: Record<IntelligenceEntityType, string> = {
  trial: 'Trial',
  marker: 'Marker',
  company: 'Company',
  product: 'Asset',
  space: 'Engagement',
};

/**
 * One row in the version history list returned by
 * `get_primary_intelligence_history`. Each version is a snapshot of a
 * primary_intelligence row that was once published, with the original
 * publish change_note attached.
 */
export interface IntelligenceVersionRow {
  id: string;
  version_number: number;
  state: VersionState;
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
  publish_note: string | null;
  published_at: string;
  published_by: string;
  archived_at: string | null;
  withdrawn_at: string | null;
  withdrawn_by: string | null;
  withdraw_note: string | null;
  diff_base_id: string | null;
}

export type IntelligenceHistoryEventKind =
  | 'draft_started'
  | 'published'
  | 'archived'
  | 'withdrawn';

export interface IntelligenceHistoryEvent {
  at: string;
  kind: IntelligenceHistoryEventKind;
  row_id: string;
  version_number: number | null;
  by: string | null;
  note: string | null;
}

/**
 * Payload returned by `get_primary_intelligence_history`. `current` is
 * the live published row (or null if withdrawn or never published).
 * `draft` is the agency-only working draft. `versions` includes the
 * live published row alongside archived and withdrawn versions, ordered
 * version_number desc. `events` is the lifecycle timeline
 * (draft_started, published, archived, withdrawn) ordered by occurrence.
 */
export interface IntelligenceHistoryPayload {
  current: PrimaryIntelligence | null;
  draft: PrimaryIntelligence | null;
  versions: IntelligenceVersionRow[];
  events: IntelligenceHistoryEvent[];
}
