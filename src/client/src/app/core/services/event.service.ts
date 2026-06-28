import { inject, Injectable } from '@angular/core';

import {
  AppEvent,
  EventCategoryDistribution,
  EventDetail,
  EventsPageData,
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
    offset = 0
  ): Promise<EventsPageData> {
    return this.cache.get(
      'get_events_page_data',
      { spaceId, filters, limit, offset },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:events`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_events_page_data', {
              p_space_id: spaceId,
              p_date_from: filters.dateFrom,
              p_date_to: filters.dateTo,
              p_entity_level: filters.entityLevel,
              p_entity_id: filters.entityId,
              p_category_names: filters.categoryNames.length > 0 ? filters.categoryNames : null,
              p_tags: filters.tags.length > 0 ? filters.tags : null,
              p_priority: filters.priority,
              p_source_type: filters.sourceType,
              p_limit: limit,
              p_offset: offset,
              p_search: filters.search,
              p_sort_field: filters.sortField ?? 'feed_ts',
              p_sort_dir: filters.sortDir ?? 'desc',
            })
            .throwOnError();
          // The overview aggregates (distribution / high_priority_count /
          // recent) summarize the full filtered set; total mirrors that count.
          const result = data as {
            items: FeedItem[];
            total: number;
            high_priority_count: number;
            distribution: EventCategoryDistribution[];
            recent: FeedItem[];
          } | null;
          return {
            items: result?.items ?? [],
            total: result?.total ?? 0,
            highPriorityCount: result?.high_priority_count ?? 0,
            distribution: result?.distribution ?? [],
            recent: result?.recent ?? [],
          };
        },
      }
    );
  }

  async getEventDetail(eventId: string): Promise<EventDetail> {
    return this.cache.get(
      'get_event_detail',
      { eventId },
      {
        ttl: HEAVY_TTL,
        tags: [`event:${eventId}:detail`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_event_detail', {
              p_event_id: eventId,
            })
            .throwOnError();
          return data as EventDetail;
        },
      }
    );
  }

  async getDetectedEvent(spaceId: string, changeEventId: string): Promise<FeedItem | null> {
    const { data } = await this.supabase.client
      .rpc('get_events_page_data', {
        p_space_id: spaceId,
        p_change_event_id: changeEventId,
        p_limit: 1,
      })
      .throwOnError();
    const result = data as { items: FeedItem[]; total: number } | null;
    return result?.items?.[0] ?? null;
  }

  async getSpaceTags(spaceId: string): Promise<string[]> {
    return this.cache.get(
      'get_space_tags',
      { spaceId },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:tags`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_space_tags', {
              p_space_id: spaceId,
            })
            .throwOnError();
          return (data ?? []) as string[];
        },
      }
    );
  }

  async create(
    spaceId: string,
    event: Partial<AppEvent>,
    sources: { url: string; label: string }[],
    linkedEventIds: string[]
  ): Promise<AppEvent> {
    const { data: newId } = await this.supabase.client
      .rpc('create_event', {
        p_space_id: spaceId,
        p_category_id: event.category_id!,
        p_title: event.title!,
        p_event_date: event.event_date!,
        p_description: event.description ?? null,
        p_priority: event.priority ?? 'low',
        p_tags: event.tags?.length ? event.tags : null,
        p_company_id: event.company_id ?? null,
        p_asset_id: event.asset_id ?? null,
        p_trial_id: event.trial_id ?? null,
      })
      .throwOnError();

    const eventId = newId as string;

    if (sources.length > 0) {
      const sourceRows = sources.map((s) => ({
        event_id: eventId,
        url: s.url,
        label: s.label || null,
      }));
      await this.supabase.client.from('event_sources').insert(sourceRows).throwOnError();
    }

    if (linkedEventIds.length > 0) {
      const linkRows = linkedEventIds.map((targetId) => ({
        source_event_id: eventId,
        target_event_id: targetId,
      }));
      await this.supabase.client.from('event_links').insert(linkRows).throwOnError();
    }

    this.cache.invalidateTags([`space:${spaceId}:events`, `space:${spaceId}:tags`]);

    const { data: row } = await this.supabase.client
      .from('events')
      .select()
      .eq('id', eventId)
      .single()
      .throwOnError();
    return row as AppEvent;
  }

  async update(id: string, changes: Partial<AppEvent>): Promise<AppEvent> {
    const { data } = await this.supabase.client
      .from('events')
      .update(changes)
      .eq('id', id)
      .select()
      .single()
      .throwOnError();

    const row = data as AppEvent;
    this.cache.invalidateTags([
      `event:${id}:detail`,
      `space:${row.space_id}:events`,
      `space:${row.space_id}:tags`,
    ]);

    return row;
  }

  async updateSources(eventId: string, sources: { url: string; label: string }[]): Promise<void> {
    await this.supabase.client
      .rpc('update_event_sources', {
        p_event_id: eventId,
        p_urls: sources.map((s) => s.url),
        p_labels: sources.map((s) => s.label ?? ''),
      })
      .throwOnError();

    this.cache.invalidateTags([`event:${eventId}:detail`]);
  }

  async updateLinks(eventId: string, linkedEventIds: string[]): Promise<void> {
    await this.supabase.client
      .rpc('update_event_links', {
        p_event_id: eventId,
        p_linked_event_ids: linkedEventIds,
      })
      .throwOnError();

    this.cache.invalidateTags([`event:${eventId}:detail`]);
  }

  /**
   * Next 1-based ordering position for a thread: the highest existing
   * `thread_order` plus one (1 for an empty thread). Used when an event joins a
   * thread so it sorts last. `thread_order` is a small `int` ordinal, not a
   * timestamp -- never assign `Date.now()`, which overflows the column.
   */
  async nextThreadOrder(threadId: string): Promise<number> {
    const { data } = await this.supabase.client
      .from('events')
      .select('thread_order')
      .eq('thread_id', threadId)
      .order('thread_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .throwOnError();
    const rows = (data as { thread_order: number | null }[] | null) ?? [];
    return (rows[0]?.thread_order ?? 0) + 1;
  }

  async delete(id: string): Promise<void> {
    const { data: row } = await this.supabase.client
      .from('events')
      .select('space_id')
      .eq('id', id)
      .single<{ space_id: string }>()
      .throwOnError();
    if (!row) throw new Error(`event ${id} not found`);

    const spaceId = row.space_id;

    await this.supabase.client.from('events').delete().eq('id', id).throwOnError();

    this.cache.invalidateTags([
      `event:${id}:detail`,
      `space:${spaceId}:events`,
      `space:${spaceId}:tags`,
    ]);
  }
}
