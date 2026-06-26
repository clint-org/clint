import { inject, Injectable } from '@angular/core';

import { SupabaseService } from '../../../core/services/supabase.service';
import { SourceProvenance } from './source-provenance.model';

/**
 * Reads import provenance for an AI-imported entity via the get_source_document
 * RPC. The RPC gates to space owners and editors; a viewer or non-member gets a
 * 42501 which surfaces here as a thrown error for the caller to handle quietly.
 */
@Injectable({ providedIn: 'root' })
export class SourceProvenanceService {
  private supabase = inject(SupabaseService);

  async getSourceDocument(sourceDocId: string): Promise<SourceProvenance | null> {
    const { data, error } = await this.supabase.client.rpc('get_source_document', {
      p_source_doc_id: sourceDocId,
    });
    if (error) throw error;
    return (data as SourceProvenance | null) ?? null;
  }
}
