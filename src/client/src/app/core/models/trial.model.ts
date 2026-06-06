import type { Condition } from './condition.model';
import { Marker } from './marker.model';

export interface Trial {
  id: string;
  space_id: string;
  created_by: string;
  asset_id: string;
  name: string;
  acronym: string | null;
  identifier: string | null;
  status: string | null;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;

  // Phase override (analyst-owned)
  phase_type: string | null;
  phase_start_date: string | null;
  phase_end_date: string | null;
  phase_type_source?: 'ctgov' | 'analyst' | null;
  phase_start_date_source?: 'ctgov' | 'analyst' | null;
  phase_end_date_source?: 'ctgov' | 'analyst' | null;

  conditions?: Condition[];
  assets?: {
    id: string;
    name: string;
    companies?: { id: string; name: string; logo_url: string | null } | null;
  } | null;
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
  most_recent_change_event_id?: string | null;

  /**
   * Dashboard-only augmentation: the asset_indication grouping this trial was
   * nested under in get_dashboard_data. Attached by DashboardService (absent
   * everywhere else). `indication_id` is the indication entity id that the
   * Indication filter (filters.indicationIds) matches against; the outer `id`
   * is the asset_indication join-row id, which is NOT what the filter holds.
   */
  _indication?: { id: string; indication_id: string; indication_name: string } | null;
}

export interface TrialNote {
  id: string;
  space_id: string;
  created_by: string;
  trial_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}
