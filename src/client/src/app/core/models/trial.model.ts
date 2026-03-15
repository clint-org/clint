import { TrialMarker } from './marker.model';

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
  therapeutic_areas?: TherapeuticArea;
  trial_phases?: TrialPhase[];
  trial_markers?: TrialMarker[];
  trial_notes?: TrialNote[];
}

export interface TrialPhase {
  id: string;
  space_id: string;
  created_by: string;
  trial_id: string;
  phase_type: string;
  start_date: string;
  end_date: string | null;
  color: string | null;
  label: string | null;
  created_at: string;
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
