import { inject, Injectable } from '@angular/core';

import { Space, SpaceMember } from '../models/space.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class SpaceService {
  private supabase = inject(SupabaseService);

  async createSpace(tenantId: string, name: string, description?: string): Promise<Space> {
    const { data, error } = await this.supabase.client.rpc('create_space', {
      p_tenant_id: tenantId,
      p_name: name,
      p_description: description ?? null,
    });
    if (error) throw error;
    return data as Space;
  }

  async listSpaces(tenantId: string): Promise<Space[]> {
    const { data, error } = await this.supabase.client
      .from('spaces')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  async getSpace(id: string): Promise<Space> {
    const { data, error } = await this.supabase.client
      .from('spaces')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async updateSpace(id: string, updates: Partial<Space>): Promise<Space> {
    const { data, error } = await this.supabase.client
      .from('spaces')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteSpace(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('spaces').delete().eq('id', id);
    if (error) throw error;
  }

  async listMembers(spaceId: string): Promise<SpaceMember[]> {
    const { data, error } = await this.supabase.client
      .from('space_members_view')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  async addMember(
    spaceId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer'
  ): Promise<SpaceMember> {
    const { data, error } = await this.supabase.client
      .from('space_members')
      .insert({ space_id: spaceId, user_id: userId, role })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateMemberRole(
    spaceId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer'
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('space_members')
      .update({ role })
      .eq('space_id', spaceId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async removeMember(spaceId: string, userId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('space_members')
      .delete()
      .eq('space_id', spaceId)
      .eq('user_id', userId);
    if (error) throw error;
  }
}
