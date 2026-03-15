import { inject, Injectable } from '@angular/core';

import { Tenant, TenantMember, TenantInvite } from '../models/tenant.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class TenantService {
  private supabase = inject(SupabaseService);

  async createTenant(name: string, slug: string): Promise<Tenant> {
    const { data, error } = await this.supabase.client.rpc('create_tenant', {
      p_name: name,
      p_slug: slug,
    });
    if (error) throw error;
    return data as Tenant;
  }

  async listMyTenants(): Promise<Tenant[]> {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .select('*')
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  async getTenant(id: string): Promise<Tenant> {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async updateTenant(id: string, updates: Partial<Tenant>): Promise<Tenant> {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async listMembers(tenantId: string): Promise<TenantMember[]> {
    const { data, error } = await this.supabase.client
      .from('tenant_members_view')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  async removeMember(tenantId: string, userId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('tenant_members')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async createInvite(tenantId: string, email: string, role: 'owner' | 'member'): Promise<TenantInvite> {
    const code = this.generateCode();
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('tenant_invites')
      .insert({ tenant_id: tenantId, email, role, invite_code: code, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async listInvites(tenantId: string): Promise<TenantInvite[]> {
    const { data, error } = await this.supabase.client
      .from('tenant_invites')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('accepted_at', null)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  async joinByCode(code: string): Promise<Tenant> {
    const { data: invite, error: findError } = await this.supabase.client
      .from('tenant_invites')
      .select('*')
      .eq('invite_code', code)
      .is('accepted_at', null)
      .single();
    if (findError) throw new Error('Invalid or expired invite code');

    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { error: memberError } = await this.supabase.client
      .from('tenant_members')
      .insert({ tenant_id: invite.tenant_id, user_id: userId, role: invite.role });
    if (memberError) throw memberError;

    await this.supabase.client
      .from('tenant_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    return this.getTenant(invite.tenant_id);
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
