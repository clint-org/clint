import { inject, Injectable } from '@angular/core';

import { Company } from '../models/company.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private supabase = inject(SupabaseService);

  async list(spaceId: string): Promise<Company[]> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .select('*, products(*)')
      .eq('space_id', spaceId)
      .order('display_order');
    if (error) throw error;
    return data as Company[];
  }

  async getById(id: string): Promise<Company> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .select('*, products(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as Company;
  }

  async create(spaceId: string, company: Partial<Company>): Promise<Company> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('companies')
      .insert({ ...company, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as Company;
  }

  async update(id: string, changes: Partial<Company>): Promise<Company> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Company;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('companies')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
