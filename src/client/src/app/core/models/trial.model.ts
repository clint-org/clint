import { Marker } from './marker.model';

export interface Trial {
  id: string;
  space_id: string;
  created_by: string;
  product_id: string;
  therapeutic_area_id: string;
  name: string;
  identifier: string | null;
  status: string | null;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;

  // Phase override (analyst-owned)
  phase_type: string | null;
  phase_start_date: string | null;
  phase_end_date: string | null;

  therapeutic_areas?: TherapeuticArea;
  markers?: Marker[];
  trial_notes?: TrialNote[];

  // CT.gov materialized columns (only the 3 that survived Phase 7)
  recruitment_status?: string | null;
  study_type?: string | null;
  phase?: string | null;
  last_update_posted_date?: string | null;

  // Sync tracking
  ctgov_last_synced_at?: string | null;
  latest_ctgov_version?: number | null;
  last_polled_at?: string | null;

  // Change-feed badge fields (from get_dashboard_data)
  recent_changes_count?: number;
  most_recent_change_type?: string | null;
}

export interface TrialNote {
  id: string;
  space_id: string;
  created_by: string;
  trial_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface TherapeuticArea {
  id: string;
  space_id: string;
  created_by: string;
  name: string;
  abbreviation: string | null;
  created_at: string;
}
