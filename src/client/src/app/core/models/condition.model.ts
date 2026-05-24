/**
 * CT.gov-sourced medical condition. Matched by MeSH ID for deduplication
 * across trials that describe the same condition with different wording.
 * Conditions map to analyst-created indications via condition_indication_map.
 */
export interface Condition {
  id: string;
  space_id: string;
  name: string;
  mesh_id: string | null;
  source: 'ctgov' | 'analyst';
  created_at: string;
}
