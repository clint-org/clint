/**
 * Analyst-created indication: the business/regulatory grouping for competitive
 * analysis. Replaces the former therapeutic_areas concept. Supports one level
 * of hierarchy via parent_id (e.g., "Heart Failure" > "HFrEF").
 */
export interface Indication {
  id: string;
  space_id: string;
  name: string;
  abbreviation: string | null;
  parent_id: string | null;
  display_order: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
