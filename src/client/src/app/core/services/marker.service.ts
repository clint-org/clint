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
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('markers')
      .insert({ ...marker, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;

    if (trialIds.length > 0) {
      const assignments = trialIds.map((trialId) => ({
        marker_id: data.id,
        trial_id: trialId,
      }));
      const { error: assignError } = await this.supabase.client
        .from('marker_assignments')
        .insert(assignments);
      if (assignError) throw assignError;
    }

    this.cache.invalidateTags([...spaceTagsFor(spaceId), ...trialDetailTags(trialIds)]);

    return data as Marker;
  }

  async update(id: string, changes: Partial<Marker>): Promise<Marker> {
    // Capture trial assignments before the mutation so we can invalidate
    // the right trial-detail caches even if the change does not return them.
    const { data: assignmentRows } = await this.supabase.client
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', id);
    const trialIds = (assignmentRows ?? []).map((r) => r.trial_id as string);

    const { data, error } = await this.supabase.client
      .from('markers')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

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

    const { error: deleteError } = await this.supabase.client
      .from('marker_assignments')
      .delete()
      .eq('marker_id', markerId);
    if (deleteError) throw deleteError;

    if (trialIds.length > 0) {
      const assignments = trialIds.map((trialId) => ({
        marker_id: markerId,
        trial_id: trialId,
      }));
      const { error: insertError } = await this.supabase.client
        .from('marker_assignments')
        .insert(assignments);
      if (insertError) throw insertError;
    }

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

    const { error } = await this.supabase.client.from('markers').delete().eq('id', id);
    if (error) throw error;

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
