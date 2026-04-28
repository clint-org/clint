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

  async provisionDemoWorkspace(): Promise<{ tenant_id: string; created: boolean }> {
    const { data, error } = await this.supabase.client.rpc('provision_demo_workspace');
    if (error) throw error;
    return data as { tenant_id: string; created: boolean };
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

  async deleteTenant(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tenants').delete().eq('id', id);
    if (error) throw error;
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

  async createInvite(
    tenantId: string,
    email: string,
    role: 'owner' | 'member'
  ): Promise<TenantInvite> {
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
    const { data, error } = await this.supabase.client.rpc('accept_invite', {
      p_code: code,
    });
    if (error) throw error;
    return data as Tenant;
  }

  async updateMemberRole(tenantId: string, userId: string, role: 'owner' | 'member'): Promise<void> {
    const { error } = await this.supabase.client
      .from('tenant_members')
      .update({ role })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async uploadLogo(tenantId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop() ?? 'png';
    const path = `${tenantId}/logo.${ext}`;

    const { error: uploadError } = await this.supabase.client.storage
      .from('tenant-logos')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw uploadError;

    const { data } = this.supabase.client.storage
      .from('tenant-logos')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async deleteLogo(tenantId: string): Promise<void> {
    const { data: files } = await this.supabase.client.storage
      .from('tenant-logos')
      .list(tenantId);

    if (files && files.length > 0) {
      const paths = files.map((f) => `${tenantId}/${f.name}`);
      await this.supabase.client.storage.from('tenant-logos').remove(paths);
    }
  }

  async getTenantAccessSettings(
    tenantId: string
  ): Promise<{ email_domain_allowlist: string[]; email_self_join_enabled: boolean }> {
    const { data, error } = await this.supabase.client.rpc('get_tenant_access_settings', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data as { email_domain_allowlist: string[]; email_self_join_enabled: boolean };
  }

  async updateTenantAccess(
    tenantId: string,
    settings: { email_domain_allowlist?: string[]; email_self_join_enabled?: boolean }
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('update_tenant_access', {
      p_tenant_id: tenantId,
      p_settings: settings,
    });
    if (error) throw error;
  }

  async selfJoinTenant(
    subdomain: string
  ): Promise<{ id: string; name: string; role: string }> {
    const { data, error } = await this.supabase.client.rpc('self_join_tenant', {
      p_subdomain: subdomain,
    });
    if (error) throw error;
    return data as { id: string; name: string; role: string };
  }

  /**
   * Best-effort check: tenant_members RLS lets a member read their own
   * row + fellow members' rows. If we read 0 rows for a tenant, the caller
   * is not a member. Returns false on any error to be safe (the caller
   * will then attempt self-join, which is idempotent on conflict).
   */
  async checkIsTenantMember(tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase.client
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
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
