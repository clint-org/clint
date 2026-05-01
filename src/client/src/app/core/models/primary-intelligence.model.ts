/**
 * Primary intelligence -- Stout's authored read on an entity in the
 * engagement (trial, marker, company, product, or the space itself).
 *
 * Mirrors the Postgres tables `primary_intelligence`,
 * `primary_intelligence_links`, `primary_intelligence_revisions`. The
 * `*Detail` types match the jsonb shape returned by
 * `get_*_detail_with_intelligence()` and `get_space_intelligence()`.
 */

export type IntelligenceEntityType = 'trial' | 'marker' | 'company' | 'product' | 'space';

export type IntelligenceLinkEntityType = Exclude<IntelligenceEntityType, 'space'>;

export type IntelligenceState = 'draft' | 'published';

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
  last_edited_by: string;
  created_at: string;
  updated_at: string;
}

export interface PrimaryIntelligenceLink {
  id?: string;
  entity_type: IntelligenceLinkEntityType;
  entity_id: string;
  relationship_type: string;
  gloss: string | null;
  display_order: number;
}

export interface PrimaryIntelligenceRevision {
  id: string;
  state: IntelligenceState;
  headline: string;
  change_note: string | null;
  edited_by: string;
  edited_at: string;
}

/** Full payload returned by `build_intelligence_payload` (jsonb) */
export interface IntelligencePayload {
  record: PrimaryIntelligence;
  links: PrimaryIntelligenceLink[];
  contributors: string[];
  recent_revisions: PrimaryIntelligenceRevision[];
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
  links: Pick<PrimaryIntelligenceLink, 'entity_type' | 'entity_id' | 'relationship_type' | 'gloss'>[];
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
  product: 'Product',
  space: 'Engagement',
};
