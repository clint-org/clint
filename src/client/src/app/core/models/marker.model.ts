export interface MarkerType {
  id: string;
  space_id: string | null;
  created_by: string | null;
  name: string;
  icon: string | null;
  shape: 'circle' | 'diamond' | 'flag' | 'arrow' | 'x' | 'bar';
  fill_style: 'outline' | 'filled' | 'striped' | 'gradient';
  color: string;
  is_system: boolean;
  display_order: number;
  created_at: string;
}

export interface TrialMarker {
  id: string;
  space_id: string;
  created_by: string;
  trial_id: string;
  marker_type_id: string;
  event_date: string;
  end_date: string | null;
  tooltip_text: string | null;
  tooltip_image_url: string | null;
  is_projected: boolean;
  created_at: string;
  updated_at: string;
  marker_types?: MarkerType;
}
