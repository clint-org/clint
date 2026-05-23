import { inject, Injectable } from '@angular/core';

import {
  AppEvent,
  EventDetail,
  EventsPageFilters,
  FeedItem,
} from '../models/event.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

@Injectable({ providedIn: 'root' })
export class EventService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async getEventsPageData(
    spaceId: string,
    filters: EventsPageFilters,
    limit = 50,
    offset = 0,
  ): Promise<FeedItem[]> {
    return this.cache.get('get_events_page_data', { spaceId, filters, limit, offset }, {
      ttl: HEAVY_TTL,
      tags: [`space:${spaceId}:events`],
      fetch: async () => {
        const { data, error } = await this.supabase.client.rpc('get_events_page_data', {
          p_space_id: spaceId,
          p_date_from: filters.dateFrom,
          p_date_to: filters.dateTo,
          p_entity_level: filters.entityLevel,
          p_entity_id: filters.entityId,
          p_category_ids: filters.categoryIds.length > 0 ? filters.categoryIds : null,
          p_tags: filters.tags.length > 0 ? filters.tags : null,
          p_priority: filters.priority,
          p_source_type: filters.sourceType,
          p_limit: limit,
          p_offset: offset,
        });
        if (error) throw error;
        return (data ?? []) as FeedItem[];
      },
    });
  }

  async getEventDetail(eventId: string): Promise<EventDetail> {
    return this.cache.get('get_event_detail', { eventId }, {
      ttl: HEAVY_TTL,
      tags: [`event:${eventId}:detail`],
      fetch: async () => {
        const { data, error } = await this.supabase.client.rpc('get_event_detail', {
          p_event_id: eventId,
        });
        if (error) throw error;
        return data as EventDetail;
      },
    });
  }

  async getSpaceTags(spaceId: string): Promise<string[]> {
    return this.cache.get('get_space_tags', { spaceId }, {
      ttl: HEAVY_TTL,
      tags: [`space:${spaceId}:tags`],
      fetch: async () => {
        const { data, error } = await this.supabase.client.rpc('get_space_tags', {
          p_space_id: spaceId,
        });
        if (error) throw error;
        return (data ?? []) as string[];
      },
    });
  }

  async create(
    spaceId: string,
    event: Partial<AppEvent>,
    sources: { url: string; label: string }[],
    linkedEventIds: string[],
  ): Promise<AppEvent> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('events')
      .insert({ ...event, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;

    if (sources.length > 0) {
      const sourceRows = sources.map((s) => ({
        event_id: data.id,
        url: s.url,
        label: s.label || null,
      }));
      const { error: srcErr } = await this.supabase.client
        .from('event_sources')
        .insert(sourceRows);
      if (srcErr) throw srcErr;
    }

    if (linkedEventIds.length > 0) {
      const linkRows = linkedEventIds.map((targetId) => ({
        source_event_id: data.id,
        target_event_id: targetId,
        created_by: userId,
      }));
      const { error: linkErr } = await this.supabase.client
        .from('event_links')
        .insert(linkRows);
      if (linkErr) throw linkErr;
    }

    this.cache.invalidateTags([
      `space:${spaceId}:events`,
      `space:${spaceId}:tags`,
    ]);

    return data as AppEvent;
  }

  async update(id: string, changes: Partial<AppEvent>): Promise<AppEvent> {
    const { data, error } = await this.supabase.client
      .from('events')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    const row = data as AppEvent;
    this.cache.invalidateTags([
      `event:${id}:detail`,
      `space:${row.space_id}:events`,
      `space:${row.space_id}:tags`,
    ]);

    return row;
  }

  async updateSources(
    eventId: string,
    sources: { url: string; label: string }[],
  ): Promise<void> {
    const { error: delErr } = await this.supabase.client
      .from('event_sources')
      .delete()
      .eq('event_id', eventId);
    if (delErr) throw delErr;

    if (sources.length > 0) {
      const rows = sources.map((s) => ({
        event_id: eventId,
        url: s.url,
        label: s.label || null,
      }));
      const { error: insErr } = await this.supabase.client
        .from('event_sources')
        .insert(rows);
      if (insErr) throw insErr;
    }

    this.cache.invalidateTags([`event:${eventId}:detail`]);
  }

  async updateLinks(eventId: string, linkedEventIds: string[]): Promise<void> {
    // Delete existing links where this event is the source
    const { error: delErr } = await this.supabase.client
      .from('event_links')
      .delete()
      .eq('source_event_id', eventId);
    if (delErr) throw delErr;

    // Also delete links where this event is the target
    const { error: delErr2 } = await this.supabase.client
      .from('event_links')
      .delete()
      .eq('target_event_id', eventId);
    if (delErr2) throw delErr2;

    if (linkedEventIds.length > 0) {
      const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
      const rows = linkedEventIds.map((targetId) => ({
        source_event_id: eventId,
        target_event_id: targetId,
        created_by: userId,
      }));
      const { error: insErr } = await this.supabase.client
        .from('event_links')
        .insert(rows);
      if (insErr) throw insErr;
    }

    this.cache.invalidateTags([`event:${eventId}:detail`]);
  }

  async delete(id: string): Promise<void> {
    const { data: row, error: lookupErr } = await this.supabase.client
      .from('events')
      .select('space_id')
      .eq('id', id)
      .single<{ space_id: string }>();
    if (lookupErr) throw lookupErr;
    if (!row) throw new Error(`event ${id} not found`);

    const spaceId = row.space_id;

    const { error } = await this.supabase.client
      .from('events')
      .delete()
      .eq('id', id);
    if (error) throw error;

    this.cache.invalidateTags([
      `event:${id}:detail`,
      `space:${spaceId}:events`,
      `space:${spaceId}:tags`,
    ]);
  }
}
