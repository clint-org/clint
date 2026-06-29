import { inject, Injectable } from '@angular/core';

import { EVENTS_SELECT, mapEventToMarker } from '../../../core/models/event-to-marker';
import type { Marker } from '../../../core/models/marker.model';
import { SupabaseService } from '../../../core/services/supabase.service';

export type EventAnchorType = 'trial' | 'company' | 'asset';

/**
 * Reads every event anchored to a single entity (trial / company / asset) as the
 * legacy Marker shape, so the standardized entity events table renders the same
 * glyph + type + category data the trial timeline uses. Returns ALL events for
 * the anchor, including feed-only (low-significance) ones -- the timeline is the
 * filtered view, this table is the complete inventory.
 */
@Injectable({ providedIn: 'root' })
export class EntityEventsService {
  private readonly supabase = inject(SupabaseService);

  async fetchForAnchor(anchorType: EventAnchorType, anchorId: string): Promise<Marker[]> {
    if (!anchorId) return [];
    const { data } = await this.supabase.client
      .from('events')
      .select(EVENTS_SELECT)
      .eq('anchor_type', anchorType)
      .eq('anchor_id', anchorId)
      .throwOnError();
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    return rows.map(mapEventToMarker);
  }
}
