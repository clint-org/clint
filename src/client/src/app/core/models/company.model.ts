import { Asset } from './asset.model';
import { Marker } from './marker.model';

export interface Company {
  id: string;
  space_id: string;
  created_by: string;
  name: string;
  logo_url: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  // Import provenance: the source_documents row this entity landed from when
  // created by an AI import. Null for manually created entities.
  source_doc_id: string | null;
  assets?: Asset[];
  // Company-anchored events (unified event model). Same JSON shape as a trial
  // marker; rendered on the company band per effectiveVisibility.
  events?: Marker[];
  // company owns published primary intelligence; intelligence_headline carries the
  // lead brief's headline (fallback most-recent published). See landscape multilevel intel.
  has_intelligence?: boolean;
  intelligence_headline?: string | null;
}
