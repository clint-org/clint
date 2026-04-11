import { Trial } from './trial.model';

export interface Product {
  id: string;
  space_id: string;
  created_by: string;
  company_id: string;
  name: string;
  generic_name: string | null;
  logo_url: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  trials?: Trial[];
  mechanisms_of_action?: { id: string; name: string }[];
  routes_of_administration?: { id: string; name: string; abbreviation: string | null }[];
}
