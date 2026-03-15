import { inject, Injectable } from '@angular/core';

import { Company } from '../models/company.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private supabase = inject(SupabaseService);

  async list(): Promise<Company[]> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .select('*, products(*)')
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

  async create(company: Partial<Company>): Promise<Company> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .insert(company)
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
