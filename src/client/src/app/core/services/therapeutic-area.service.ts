import { inject, Injectable } from '@angular/core';

import { TherapeuticArea } from '../models/trial.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class TherapeuticAreaService {
  private supabase = inject(SupabaseService);

  async list(): Promise<TherapeuticArea[]> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .select('*')
      .order('name');

    if (error) throw error;
    return data as TherapeuticArea[];
  }

  async getById(id: string): Promise<TherapeuticArea> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as TherapeuticArea;
  }

  async create(area: Partial<TherapeuticArea>): Promise<TherapeuticArea> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .insert(area)
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
