import { Trial } from './trial.model';

/**
 * Frontend Asset record: a drug asset belonging to a company within a space.
 * Backed by the `products` table; the rename is vocabulary-only.
 */
export interface Asset {
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
  companies?: { id: string; name: string; logo_url: string | null } | null;
}
