/**
 * Import provenance for an AI-imported entity: the source_documents row a
 * company / asset / trial / marker / event landed from, returned by the
 * get_source_document RPC. Visible to space owners and editors only.
 */
export interface SourceProvenance {
  source_doc_id: string;
  space_id: string;
  source_title: string | null;
  source_kind: 'url' | 'text';
  source_url: string | null;
  source_text: string;
  fetched_at: string;
  fetch_outcome: 'success' | 'failed' | 'paste';
  created_at: string;
  imported_by_email: string | null;
  ai_model: string | null;
  ai_outcome: string | null;
}
