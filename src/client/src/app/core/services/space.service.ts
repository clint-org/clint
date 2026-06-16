import { inject, Injectable, signal } from '@angular/core';

import { Space, SpaceMember, SpaceInvite } from '../models/space.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class SpaceService {
  private supabase = inject(SupabaseService);

  /**
   * Monotonic tick bumped after every mutation that changes the set of
   * active spaces for a tenant (create / archive / restore / permanent
   * delete). Consumers that cache the space list (e.g. the app-shell space
   * picker) read this signal to reload, since the list is otherwise a
   * snapshot taken only on tenant switch.
   */
  private readonly _spacesChanged = signal(0);
  readonly spacesChanged = this._spacesChanged.asReadonly();

  private notifySpacesChanged(): void {
    this._spacesChanged.update((n) => n + 1);
  }

  async createSpace(tenantId: string, name: string, description?: string): Promise<Space> {
    const { data } = await this.supabase.client
      .rpc('create_space', {
        p_tenant_id: tenantId,
        p_name: name,
        p_description: description ?? null,
      })
      .throwOnError();
    this.notifySpacesChanged();
    return data as Space;
  }

  async listSpaces(tenantId: string): Promise<Space[]> {
    // Default list excludes archived spaces (cascade-safety #1: archived
    // spaces are still in the table but should not surface in the picker).
    // Use SpaceService.listArchivedSpaces to fetch the inverse.
    const { data } = await this.supabase.client
      .from('spaces')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .order('created_at')
      .throwOnError();
    return data ?? [];
  }

  /**
   * The set of space ids the current user can actually enter. The
   * space_members SELECT policy is `has_space_access(space_id)`, so any row
   * the caller can read belongs to a space they can access -- the distinct
   * space_ids are exactly the accessible set. A tenant owner who can *see* a
   * space in listSpaces (via the spaces-table policy) but has no membership
   * row will not appear here, which is the firewall by design (runbook 09).
   */
  async listAccessibleSpaceIds(): Promise<Set<string>> {
    const { data } = await this.supabase.client
      .from('space_members')
      .select('space_id')
      .throwOnError();
    return new Set((data ?? []).map((r) => r.space_id as string));
  }

  /**
   * Lists archived spaces for the tenant. Archived spaces are still
   * subject to RLS, so the caller must have at least space access (or be
   * a tenant owner / platform admin) to see them.
   */
  async listArchivedSpaces(tenantId: string): Promise<Space[]> {
    const { data } = await this.supabase.client
      .from('spaces')
      .select('*')
      .eq('tenant_id', tenantId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .throwOnError();
    return data ?? [];
  }

  /**
   * Archive a space. Reversible via restoreSpace. Gated server-side on
   * has_space_access(p_space_id, array['owner']).
   */
  async archiveSpace(id: string): Promise<void> {
    await this.supabase.client
      .rpc('archive_space', {
        p_space_id: id,
      })
      .throwOnError();
    this.notifySpacesChanged();
  }

  /**
   * Restore an archived space (clears archived_at). Gated server-side on
   * has_space_access(p_space_id, array['owner']).
   */
  async restoreSpace(id: string): Promise<void> {
    await this.supabase.client
      .rpc('restore_space', {
        p_space_id: id,
      })
      .throwOnError();
    this.notifySpacesChanged();
  }

  /**
   * Permanently delete a space. Gated server-side on is_tenant_member(
   * spaces.tenant_id, array['owner']) OR is_platform_admin(). Non-admins
   * must archive the space first; platform admins may override. Returns
   * the jsonb count breakdown of what was purged.
   */
  async permanentlyDeleteSpace(id: string): Promise<Record<string, unknown>> {
    const { data } = await this.supabase.client
      .rpc('permanently_delete_space', { p_space_id: id })
      .throwOnError();
    this.notifySpacesChanged();
    return (data ?? {}) as Record<string, unknown>;
  }

  async getSpace(id: string): Promise<Space> {
    const { data } = await this.supabase.client
      .from('spaces')
      .select('*')
      .eq('id', id)
      .single()
      .throwOnError();
    return data;
  }

  async updateSpace(id: string, updates: Partial<Space>): Promise<Space> {
    const { data } = await this.supabase.client
      .from('spaces')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
      .throwOnError();
    return data;
  }

  async listMembers(spaceId: string): Promise<SpaceMember[]> {
    const { data } = await this.supabase.client
      .rpc('list_space_members', { p_space_id: spaceId })
      .order('created_at')
      .throwOnError();
    return data ?? [];
  }

  async addMember(
    spaceId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer'
  ): Promise<SpaceMember> {
    const { data } = await this.supabase.client
      .from('space_members')
      .insert({ space_id: spaceId, user_id: userId, role })
      .select()
      .single()
      .throwOnError();
    return data;
  }

  async updateMemberRole(
    spaceId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer'
  ): Promise<void> {
    await this.supabase.client
      .from('space_members')
      .update({ role })
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .throwOnError();
  }

  async removeMember(spaceId: string, userId: string): Promise<void> {
    await this.supabase.client
      .from('space_members')
      .delete()
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .throwOnError();
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
    const { data } = await this.supabase.client
      .rpc('invite_to_space', {
        p_space_id: spaceId,
        p_email: email,
        p_role: role,
      })
      .throwOnError();
    return data as {
      invited: boolean;
      user_id?: string;
      invite_id?: string;
      invite_code?: string;
      email?: string;
    };
  }

  async listInvites(spaceId: string): Promise<SpaceInvite[]> {
    const { data } = await this.supabase.client
      .from('space_invites')
      .select('*')
      .eq('space_id', spaceId)
      .is('accepted_at', null)
      .order('created_at')
      .throwOnError();
    return data ?? [];
  }

  async deleteInvite(inviteId: string): Promise<void> {
    await this.supabase.client.from('space_invites').delete().eq('id', inviteId).throwOnError();
  }

  async acceptSpaceInviteByCode(
    code: string
  ): Promise<{ id: string; name: string; tenant_id: string }> {
    const { data } = await this.supabase.client
      .rpc('accept_space_invite', {
        p_code: code,
      })
      .throwOnError();
    return data as { id: string; name: string; tenant_id: string };
  }
}
