import { inject, Injectable } from '@angular/core';

import { RouteOfAdministration } from '../models/route-of-administration.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class RouteOfAdministrationService {
  private supabase = inject(SupabaseService);

  async list(spaceId: string): Promise<RouteOfAdministration[]> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .select('*')
      .eq('space_id', spaceId)
      .order('display_order')
      .order('name');
    if (error) throw error;
    return data as RouteOfAdministration[];
  }

  async getById(id: string): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as RouteOfAdministration;
  }

  async create(spaceId: string, roa: Partial<RouteOfAdministration>): Promise<RouteOfAdministration> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .insert({ ...roa, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as RouteOfAdministration;
  }

  async update(id: string, changes: Partial<RouteOfAdministration>): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as RouteOfAdministration;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('routes_of_administration')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async countAssignedProducts(id: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('product_routes_of_administration')
      .select('*', { count: 'exact', head: true })
      .eq('roa_id', id);
    if (error) throw error;
    return count ?? 0;
  }
}
