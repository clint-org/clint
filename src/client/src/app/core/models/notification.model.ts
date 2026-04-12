export interface MarkerNotification {
  id: string;
  space_id: string;
  marker_id: string;
  priority: 'low' | 'high';
  summary: string;
  created_by: string;
  created_at: string;
  marker?: {
    id: string;
    title: string;
    event_date: string;
    projection: string;
    is_projected: boolean;
    marker_types?: {
      name: string;
      color: string;
      shape: string;
      marker_categories?: {
        name: string;
      };
    };
    marker_assignments?: {
      trial_id: string;
      trials?: { name: string; identifier: string | null };
    }[];
  };
  is_read?: boolean;
}
