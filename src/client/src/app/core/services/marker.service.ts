import { inject, Injectable } from '@angular/core';

import { Marker } from '../models/marker.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

function spaceTagsFor(spaceId: string): string[] {
  return [
    `space:${spaceId}:activity`,
    `space:${spaceId}:dashboard`,
    `space:${spaceId}:landing-stats`,
    `space:${spaceId}:trials`,
  ];
}

function trialDetailTags(trialIds: string[]): string[] {
  return trialIds.map((id) => `trial:${id}:detail`);
}

@Injectable({ providedIn: 'root' })
export class MarkerService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async create(spaceId: string, marker: Partial<Marker>, trialIds: string[]): Promise<Marker> {
    const { data: newId } = await this.supabase.client
      .rpc('create_marker', {
        p_space_id: spaceId,
        p_marker_type_id: marker.marker_type_id!,
        p_title: marker.title!,
        p_projection: marker.projection!,
        p_event_date: marker.event_date!,
        p_end_date: marker.end_date ?? null,
        p_description: marker.description ?? null,
        p_source_url: marker.source_url ?? null,
        p_trial_ids: trialIds.length > 0 ? trialIds : null,
        p_change_source: 'analyst',
      })
      .throwOnError();

    this.cache.invalidateTags([...spaceTagsFor(spaceId), ...trialDetailTags(trialIds)]);

    const created = await this.getById(newId as string);
    if (!created) throw new Error('Marker not found after creation');
    return created;
  }

  async update(id: string, changes: Partial<Marker>): Promise<Marker> {
    // Capture trial assignments before the mutation so we can invalidate
    // the right trial-detail caches even if the change does not return them.
    const { data: assignmentRows } = await this.supabase.client
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', id);
    const trialIds = (assignmentRows ?? []).map((r) => r.trial_id as string);

    const { data } = await this.supabase.client
      .from('markers')
      .update(changes)
      .eq('id', id)
      .select()
      .single()
      .throwOnError();

    const updated = data as Marker;
    this.cache.invalidateTags([
      ...spaceTagsFor(updated.space_id),
      ...trialDetailTags(trialIds),
      `catalyst:${id}:detail`,
    ]);

    return updated;
  }

  async updateAssignments(markerId: string, trialIds: string[]): Promise<void> {
    // Capture the marker's space + the union of previous and new trialIds
    // so we invalidate every trial-detail cache that this change touches.
    const { data: marker } = await this.supabase.client
      .from('markers')
      .select('space_id')
      .eq('id', markerId)
      .single();
    const { data: oldRows } = await this.supabase.client
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', markerId);
    const previousTrialIds = (oldRows ?? []).map((r) => r.trial_id as string);

    // Delegate to the SECURITY DEFINER RPC. A client-side DELETE+INSERT pair
    // splits into two PostgREST transactions; the AFTER DELETE
    // _cleanup_orphan_marker trigger fires the moment the last assignment is
    // deleted and drops the parent marker, so the subsequent INSERT then
    // fails RLS WITH CHECK ("violates RLS for marker_assignments"). The RPC
    // inserts first then prunes inside one transaction, so the marker always
    // has at least one live assignment.
    await this.supabase.client
      .rpc('update_marker_assignments', {
        p_marker_id: markerId,
        p_trial_ids: trialIds,
      })
      .throwOnError();

    const affectedTrialIds = Array.from(new Set([...previousTrialIds, ...trialIds]));
    const tags: string[] = trialDetailTags(affectedTrialIds);
    if (marker?.space_id) tags.push(...spaceTagsFor(marker.space_id));
    tags.push(`catalyst:${markerId}:detail`);
    if (tags.length > 0) this.cache.invalidateTags(tags);
  }

  async delete(id: string): Promise<void> {
    const { data: marker } = await this.supabase.client
      .from('markers')
      .select('space_id')
      .eq('id', id)
      .single();
    const { data: assignmentRows } = await this.supabase.client
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', id);
    const trialIds = (assignmentRows ?? []).map((r) => r.trial_id as string);

    await this.supabase.client.from('markers').delete().eq('id', id).throwOnError();

    const tags: string[] = trialDetailTags(trialIds);
    if (marker?.space_id) tags.push(...spaceTagsFor(marker.space_id));
    tags.push(`catalyst:${id}:detail`);
    if (tags.length > 0) this.cache.invalidateTags(tags);
  }

  async getById(id: string): Promise<Marker | null> {
    const { data, error } = await this.supabase.client
      .from('markers')
      .select('*, marker_types(name, marker_categories(name))')
      .eq('id', id)
      .single();
    if (error) {
      if ((error as { code?: string }).code === 'PGRST116') return null;
      throw error;
    }
    return data as Marker;
  }
}
