export interface MarkerCategory {
  id: string;
  space_id: string | null;
  name: string;
  display_order: number;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MarkerShape = 'circle' | 'diamond' | 'flag' | 'triangle' | 'square' | 'dashed-line';
export type FillStyle = 'outline' | 'filled';
export type InnerMark = 'dot' | 'dash' | 'check' | 'x' | 'none';

export interface MarkerType {
  id: string;
  space_id: string | null;
  created_by: string | null;
  category_id: string;
  name: string;
  icon: string | null;
  shape: MarkerShape;
  fill_style: FillStyle;
  color: string;
  inner_mark: InnerMark;
  is_system: boolean;
  display_order: number;
  created_at: string;
  marker_categories?: MarkerCategory;
}

export type Projection = 'stout' | 'company' | 'primary' | 'actual';

export interface Marker {
  id: string;
  space_id: string;
  created_by: string;
  marker_type_id: string;
  title: string;
  projection: Projection;
  event_date: string;
  end_date: string | null;
  description: string | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  is_projected: boolean;
  no_longer_expected: boolean;
  created_at: string;
  updated_at: string;
  marker_types?: MarkerType;
  marker_assignments?: MarkerAssignment[];
}

export interface MarkerAssignment {
  id: string;
  marker_id: string;
  trial_id: string;
  created_at: string;
  trials?: { id: string; name: string; identifier: string | null };
}
