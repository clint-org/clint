import { Marker } from './marker.model';

export interface Trial {
  id: string;
  space_id: string;
  created_by: string;
  product_id: string;
  therapeutic_area_id: string;
  name: string;
  identifier: string | null;
  sample_size: number | null;
  status: string | null;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  phase_type: string | null;
  phase_start_date: string | null;
  phase_end_date: string | null;
  therapeutic_areas?: TherapeuticArea;
  markers?: Marker[];
  trial_notes?: TrialNote[];

  // CT.gov dimensions - logistics
  recruitment_status?: string | null;
  sponsor_type?: string | null;
  lead_sponsor?: string | null;
  collaborators?: string[] | null;
  study_countries?: string[] | null;
  study_regions?: string[] | null;

  // CT.gov dimensions - scientific design
  study_type?: string | null;
  phase?: string | null;
  design_allocation?: string | null;
  design_intervention_model?: string | null;
  design_masking?: string | null;
  design_primary_purpose?: string | null;
  enrollment_type?: string | null;

  // CT.gov dimensions - clinical context
  conditions?: string[] | null;
  intervention_type?: string | null;
  intervention_name?: string | null;
  primary_outcome_measures?: string[] | null;
  secondary_outcome_measures?: string[] | null;
  is_rare_disease?: boolean | null;

  // CT.gov dimensions - eligibility
  eligibility_sex?: string | null;
  eligibility_min_age?: string | null;
  eligibility_max_age?: string | null;
  accepts_healthy_volunteers?: boolean | null;
  eligibility_criteria?: string | null;
  sampling_method?: string | null;

  // CT.gov dimensions - timeline
  start_date?: string | null;
  start_date_type?: string | null;
  primary_completion_date?: string | null;
  primary_completion_date_type?: string | null;
  study_completion_date?: string | null;
  study_completion_date_type?: string | null;
  first_posted_date?: string | null;
  results_first_posted_date?: string | null;
  last_update_posted_date?: string | null;

  // CT.gov dimensions - regulatory
  has_dmc?: boolean | null;
  is_fda_regulated_drug?: boolean | null;
  is_fda_regulated_device?: boolean | null;
  fda_designations?: string[] | null;
  submission_type?: string | null;

  // sync tracking
  ctgov_last_synced_at?: string | null;

  // change-feed badge fields, populated by get_dashboard_data via a
  // LEFT JOIN LATERAL on trial_change_events. recent_changes_count is the
  // number of events observed in the last 7 days; most_recent_change_type is
  // the event_type of the most recent one. both may be missing on payloads
  // from RPCs that have not been extended with these fields yet, so the
  // ChangeBadgeComponent treats absent values as zero.
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
