import { Product } from './product.model';

export interface Company {
  id: string;
  space_id: string;
  created_by: string;
  name: string;
  logo_url: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  products?: Product[];
}
