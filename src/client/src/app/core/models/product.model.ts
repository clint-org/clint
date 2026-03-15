import { Trial } from './trial.model';

export interface Product {
  id: string;
  user_id: string;
  company_id: string;
  name: string;
  generic_name: string | null;
  logo_url: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  trials?: Trial[];
}
