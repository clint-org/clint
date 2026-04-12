import { inject, Injectable } from '@angular/core';

import { Marker } from '../models/marker.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class MarkerService {
  private supabase = inject(SupabaseService);

  async create(spaceId: string, marker: Partial<Marker>, trialIds: string[]): Promise<Marker> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('markers')
      .insert({ ...marker, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;

    if (trialIds.length > 0) {
      const assignments = trialIds.map(trialId => ({
        marker_id: data.id,
        trial_id: trialId,
      }));
      const { error: assignError } = await this.supabase.client
        .from('marker_assignments')
        .insert(assignments);
      if (assignError) throw assignError;
    }

    return data as Marker;
  }

  async update(id: string, changes: Partial<Marker>): Promise<Marker> {
    const { data, error } = await this.supabase.client
      .from('markers')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Marker;
  }

  async updateAssignments(markerId: string, trialIds: string[]): Promise<void> {
    const { error: deleteError } = await this.supabase.client
      .from('marker_assignments')
      .delete()
      .eq('marker_id', markerId);
    if (deleteError) throw deleteError;

    if (trialIds.length > 0) {
      const assignments = trialIds.map(trialId => ({
        marker_id: markerId,
        trial_id: trialId,
      }));
      const { error: insertError } = await this.supabase.client
        .from('marker_assignments')
        .insert(assignments);
      if (insertError) throw insertError;
    }
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('markers').delete().eq('id', id);
    if (error) throw error;
  }
}
