import { inject, Injectable } from '@angular/core';

import { Space, SpaceMember, SpaceInvite } from '../models/space.model';
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
    const { error } = await this.supabase.client.rpc('delete_space', { p_space_id: id });
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

  /**
   * Add or invite a user to a space at the given role. If the email matches
   * an existing auth.users row, the user is added directly (role updated if
   * already a member). Otherwise a pending invite is held; the user accepts
   * by passing invite_code through accept_space_invite() after sign-in.
   */
  async inviteToSpace(
    spaceId: string,
    email: string,
    role: 'owner' | 'editor' | 'viewer'
  ): Promise<{
    invited: boolean;
    user_id?: string;
    invite_id?: string;
    invite_code?: string;
    email?: string;
  }> {
    const { data, error } = await this.supabase.client.rpc('invite_to_space', {
      p_space_id: spaceId,
      p_email: email,
      p_role: role,
    });
    if (error) throw error;
    return data as {
      invited: boolean;
      user_id?: string;
      invite_id?: string;
      invite_code?: string;
      email?: string;
    };
  }

  async listInvites(spaceId: string): Promise<SpaceInvite[]> {
    const { data, error } = await this.supabase.client
      .from('space_invites')
      .select('*')
      .eq('space_id', spaceId)
      .is('accepted_at', null)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  async deleteInvite(inviteId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('space_invites')
      .delete()
      .eq('id', inviteId);
    if (error) throw error;
  }

  async acceptSpaceInviteByCode(code: string): Promise<{ id: string; name: string; tenant_id: string }> {
    const { data, error } = await this.supabase.client.rpc('accept_space_invite', {
      p_code: code,
    });
    if (error) throw error;
    return data as { id: string; name: string; tenant_id: string };
  }
}
