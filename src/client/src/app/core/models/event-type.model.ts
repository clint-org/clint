import type { FillStyle, InnerMark, MarkerShape } from './marker.model';

export interface EventType {
  id: string;
  space_id: string | null;
  category_id: string;
  name: string;
  shape: MarkerShape;
  fill_style: FillStyle;
  color: string;
  inner_mark: InnerMark;
  default_significance: 'high' | 'low';
  is_system: boolean;
  display_order: number;
}
