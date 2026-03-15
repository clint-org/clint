import { inject, Injectable } from '@angular/core';

import { TrialNote } from '../models/trial.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class TrialNoteService {
  private supabase = inject(SupabaseService);

  async create(note: Partial<TrialNote>): Promise<TrialNote> {
    const { data, error } = await this.supabase.client
      .from('trial_notes')
      .insert(note)
      .select()
      .single();

    if (error) throw error;
    return data as TrialNote;
  }

  async update(id: string, changes: Partial<TrialNote>): Promise<TrialNote> {
    const { data, error } = await this.supabase.client
      .from('trial_notes')
      .update(changes)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as TrialNote;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('trial_notes')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}
