import { Asset } from './asset.model';

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
}
