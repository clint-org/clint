import { inject, Injectable } from '@angular/core';

import { Marker } from '../models/marker.model';
import { EVENTS_SELECT, mapEventToMarker } from '../models/event-to-marker';
import { landscapeAllTag } from './cache-tags';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

function spaceTagsFor(spaceId: string): string[] {
  return [
    `space:${spaceId}:activity`,
    `space:${spaceId}:dashboard`,
    `space:${spaceId}:landing-stats`,
    `space:${spaceId}:trials`,
    // Markers are trial events that drive phase positioning on the bullseye /
    // heatmap / landscape reads; invalidate their umbrella tag so those refresh
    // after a marker write instead of serving pre-edit data for the TTL (#177).
    landscapeAllTag(spaceId),
  ];
}

function trialDetailTags(trialIds: string[]): string[] {
  return trialIds.map((id) => `trial:${id}:detail`);
}

/**
 * Manage/trials marker authoring, repointed onto the unified `events` model.
 * Every marker is a single-anchor trial event (`anchor_type='trial'`); there
 * is no separate assignment concept. Inserts go through the `create_event`
 * SECURITY DEFINER RPC; metadata, partial updates, and deletes are inline
 * writes to `events` (the same established pattern as `event.service.ts`).
 * The Marker output shape is preserved via `mapEventToMarker` so the manage
 * list, phase-bar derivation, and edit-prefill are unaffected.
 */
@Injectable({ providedIn: 'root' })
export class MarkerService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async create(spaceId: string, marker: Partial<Marker>, trialId: string): Promise<Marker> {
    const { data: newId } = await this.supabase.client
      .rpc('create_event', {
        p_space_id: spaceId,
        p_event_type_id: marker.marker_type_id!,
        p_title: marker.title!,
        p_event_date: marker.event_date!,
        p_anchor_type: 'trial',
        p_anchor_id: trialId,
        p_projection: marker.projection!,
        p_date_precision: marker.date_precision ?? 'exact',
        p_end_date: marker.end_date ?? null,
        p_end_date_precision: marker.end_date_precision ?? 'exact',
        p_is_ongoing: marker.is_ongoing ?? false,
        p_description: marker.description ?? null,
        // The manage form has one Source URL field -> one citation. Writes go
        // through event_sources (p_sources), never the legacy scalar.
        p_sources: marker.source_url ? [{ url: marker.source_url, label: null }] : null,
      })
      .throwOnError();

    const eventId = newId as string;

    // metadata is not a create_event param; round-trip it with an inline
    // events update so the regulatory-pathway / trial-date metadata persists.
    if (marker.metadata !== null && marker.metadata !== undefined) {
      await this.supabase.client
        .from('events')
        .update({ metadata: marker.metadata })
        .eq('id', eventId)
        .throwOnError();
    }

    this.cache.invalidateTags([...spaceTagsFor(spaceId), ...trialDetailTags([trialId])]);

    const created = await this.getById(eventId);
    if (!created) throw new Error('Marker not found after creation');
    return created;
  }

  async update(id: string, changes: Partial<Marker>): Promise<Marker> {
    // Map marker fields to event columns. Every field is 1:1 except
    // marker_type_id -> event_type_id. Only include keys present in `changes`
    // so this stays a partial update (update_event is full-replace and unsafe
    // for the partial date-only writes trial-edit-dialog performs).
    const mapped: Record<string, unknown> = {};
    if ('marker_type_id' in changes) mapped['event_type_id'] = changes.marker_type_id;
    const passthrough = [
      'title',
      'event_date',
      'projection',
      'date_precision',
      'end_date',
      'end_date_precision',
      'is_ongoing',
      'description',
      'metadata',
      'significance',
      'visibility',
    ] as const;
    for (const key of passthrough) {
      if (key in changes) mapped[key] = (changes as Record<string, unknown>)[key];
    }

    const { data } = await this.supabase.client
      .from('events')
      .update(mapped)
      .eq('id', id)
      .select()
      .single()
      .throwOnError();

    // source_url is no longer an events column: route the single Source URL
    // field to the citations via update_event_sources (replace-all to one
    // citation, or clear when blank).
    if (changes.source_url !== undefined) {
      await this.supabase.client
        .rpc('update_event_sources', {
          p_event_id: id,
          p_urls: changes.source_url ? [changes.source_url] : [],
          p_labels: changes.source_url ? [null] : [],
        })
        .throwOnError();
    }

    const row = data as Record<string, unknown>;
    const spaceId = row['space_id'] as string;
    const anchorId = row['anchor_id'] as string | null;
    const tags: string[] = [...spaceTagsFor(spaceId), `catalyst:${id}:detail`];
    if (anchorId) tags.push(...trialDetailTags([anchorId]));
    this.cache.invalidateTags(tags);

    return mapEventToMarker(row);
  }

  async delete(id: string): Promise<void> {
    const { data: row } = await this.supabase.client
      .from('events')
      .select('space_id, anchor_id')
      .eq('id', id)
      .single<{ space_id: string; anchor_id: string | null }>();

    await this.supabase.client.from('events').delete().eq('id', id).throwOnError();

    const tags: string[] = [`catalyst:${id}:detail`];
    if (row?.space_id) tags.push(...spaceTagsFor(row.space_id));
    if (row?.anchor_id) tags.push(...trialDetailTags([row.anchor_id]));
    this.cache.invalidateTags(tags);
  }

  async getById(id: string): Promise<Marker | null> {
    const { data, error } = await this.supabase.client
      .from('events')
      .select(EVENTS_SELECT)
      .eq('id', id)
      .single();
    if (error) {
      if ((error as { code?: string }).code === 'PGRST116') return null;
      throw error;
    }
    return mapEventToMarker(data as Record<string, unknown>);
  }
}
