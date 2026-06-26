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

  // Import provenance: the source_documents row this entity landed from when
  // created by an AI import. Null for manually created entities.
  source_doc_id: string | null;

  // Phase override (analyst-owned). Dates are derived from Trial Start / Trial
  // End / PCD markers via deriveTrialPhaseSpan (core/models/trial-phase-span.ts).
  phase_type: string | null;
  phase_type_source?: 'ctgov' | 'analyst' | null;

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
   * Dashboard-only augmentation: every indication grouping this trial was
   * nested under in get_dashboard_data. A trial can span multiple of its
   * asset's indications (e.g. a trial whose conditions map to both Obesity and
   * Overweight); the RPC nests it once per indication, and DashboardService
   * dedupes those into a single row carrying all of them here. Attached by
   * DashboardService (absent everywhere else). `indication_id` is the
   * indication entity id that the Indication filter (filters.indicationIds)
   * matches against; `id` mirrors it (the RPC does not surface the
   * asset_indication join-row id).
   */
  _indications?: { id: string; indication_id: string; indication_name: string }[];
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
