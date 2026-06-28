import type { DevelopmentStatus } from './phase-colors';
import { Trial } from './trial.model';

/**
 * An asset's program in a specific indication. Carries the development status
 * (PRECLIN through LAUNCHED) which is either auto-derived from trial phases
 * or analyst-overridden.
 */
export interface AssetIndication {
  id: string;
  asset_id: string;
  indication_id: string;
  indication_name: string;
  indication_abbreviation: string | null;
  development_status: DevelopmentStatus | null;
  development_status_source: 'auto' | 'analyst';
  trials?: Trial[];
}

/**
 * Frontend Asset record: a drug asset belonging to a company within a space.
 * Backed by the `assets` table (renamed from `products`).
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
  updated_by: string | null;
  // Import provenance: the source_documents row this entity landed from when
  // created by an AI import. Null for manually created entities.
  source_doc_id: string | null;
  trials?: Trial[];
  indications?: AssetIndication[];
  mechanisms_of_action?: { id: string; name: string }[];
  routes_of_administration?: { id: string; name: string; abbreviation: string | null }[];
  companies?: { id: string; name: string; logo_url: string | null } | null;
  // asset owns published primary intelligence; intelligence_headline carries the
  // lead brief's headline (fallback most-recent published). See landscape multilevel intel.
  has_intelligence?: boolean;
  intelligence_headline?: string | null;
}
