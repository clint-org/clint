import { inject, Injectable } from '@angular/core';

import { TherapeuticArea } from '../models/trial.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class TherapeuticAreaService {
  private supabase = inject(SupabaseService);

  async list(spaceId: string): Promise<TherapeuticArea[]> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .select('*')
      .eq('space_id', spaceId)
      .order('name');
    if (error) throw error;
    return data as TherapeuticArea[];
  }

  async create(spaceId: string, area: Partial<TherapeuticArea>): Promise<TherapeuticArea> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .insert({ ...area, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as TherapeuticArea;
  }

  async update(id: string, changes: Partial<TherapeuticArea>): Promise<TherapeuticArea> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as TherapeuticArea;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('therapeutic_areas')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
