export interface Catalyst {
  marker_id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  category_name: string;
  category_id: string;
  marker_type_name: string;
  marker_type_icon: string | null;
  marker_type_color: string;
  marker_type_shape: string;
  is_projected: boolean;
  company_name: string | null;
  company_id: string | null;
  product_name: string | null;
  product_id: string | null;
  trial_name: string | null;
  trial_id: string | null;
  trial_phase: string | null;
  description: string | null;
  source_url: string | null;
}

export interface CatalystDetail {
  catalyst: Catalyst & {
    recruitment_status: string | null;
  };
  upcoming_markers: UpcomingMarker[];
  related_events: RelatedEvent[];
}

export interface UpcomingMarker {
  marker_id: string;
  title: string;
  event_date: string;
  marker_type_name: string;
  is_projected: boolean;
}

export interface RelatedEvent {
  event_id: string;
  title: string;
  event_date: string;
  category_name: string;
}

export interface CatalystFilters {
  category_ids?: string[];
  company_id?: string;
  product_id?: string;
}

export interface CatalystGroup {
  label: string;
  date_range: string;
  catalysts: Catalyst[];
}

/** Catalyst with computed time_bucket field for p-table row grouping. */
export interface FlatCatalyst extends Catalyst {
  time_bucket: string;
  time_bucket_range: string;
}
