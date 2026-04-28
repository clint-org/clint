import { inject, Injectable } from '@angular/core';

import {
  Agency,
  AgencyMember,
  AgencyBrandingUpdate,
  AgencyTenantSummary,
  TenantBrandFields,
  TenantBrandingUpdate,
} from '../models/agency.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AgencyService {
  private supabase = inject(SupabaseService);

  // ---------------------------------------------------------------------------
  // agencies
  // ---------------------------------------------------------------------------

  async listMyAgencies(): Promise<Agency[]> {
    const { data, error } = await this.supabase.client
      .from('agencies')
      .select('*')
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  async getAgency(id: string): Promise<Agency> {
    const { data, error } = await this.supabase.client
      .from('agencies')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async updateAgencyBranding(
    id: string,
    branding: AgencyBrandingUpdate
  ): Promise<{ id: string; updated: boolean }> {
    const { data, error } = await this.supabase.client.rpc('update_agency_branding', {
      p_agency_id: id,
      p_branding: branding,
    });
    if (error) throw error;
    return data as { id: string; updated: boolean };
  }

  // ---------------------------------------------------------------------------
  // agency members
  // ---------------------------------------------------------------------------

  async listAgencyMembers(agencyId: string): Promise<AgencyMember[]> {
    // Try the joined view first; fall back to raw rows if the view isn't deployed.
    const { data, error } = await this.supabase.client
      .from('agency_members_view')
      .select('*')
      .eq('agency_id', agencyId)
      .order('created_at');
    if (error) {
      const { data: rawData, error: rawError } = await this.supabase.client
        .from('agency_members')
        .select('*')
        .eq('agency_id', agencyId)
        .order('created_at');
      if (rawError) throw rawError;
      return rawData ?? [];
    }
    return data ?? [];
  }

  async addAgencyMember(
    agencyId: string,
    userId: string,
    role: 'owner' | 'member'
  ): Promise<AgencyMember> {
    const { data, error } = await this.supabase.client
      .from('agency_members')
      .insert({ agency_id: agencyId, user_id: userId, role })
      .select()
      .single();
    if (error) throw error;
    return data as AgencyMember;
  }

  async removeAgencyMember(memberId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('agency_members')
      .delete()
      .eq('id', memberId);
    if (error) throw error;
  }

  async updateAgencyMemberRole(memberId: string, role: 'owner' | 'member'): Promise<void> {
    const { error } = await this.supabase.client
      .from('agency_members')
      .update({ role })
      .eq('id', memberId);
    if (error) throw error;
  }

  /**
   * Resolve an email to a user_id via the lookup_user_by_email RPC.
   * Returns null when the email isn't registered (not an error condition --
   * the UI should offer "send invite" as the alternative).
   */
  async lookupUserByEmail(
    email: string
  ): Promise<{ user_id: string; display_name: string } | null> {
    const { data, error } = await this.supabase.client.rpc('lookup_user_by_email', {
      p_email: email,
    });
    if (error) throw error;
    const result = data as { found: boolean; user_id?: string; display_name?: string };
    if (!result?.found || !result.user_id) return null;
    return { user_id: result.user_id, display_name: result.display_name ?? email };
  }

  // ---------------------------------------------------------------------------
  // tenants under an agency
  // ---------------------------------------------------------------------------

  async listAgencyTenants(agencyId: string): Promise<AgencyTenantSummary[]> {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .select(
        'id, name, subdomain, custom_domain, app_display_name, primary_color, logo_url, suspended_at, created_at'
      )
      .eq('agency_id', agencyId)
      .order('created_at');
    if (error) throw error;

    // Fetch member counts in a separate query (pragmatic v1 — fine for <50 tenants).
    const tenants = data ?? [];
    if (tenants.length === 0) return [];

    const { data: memberRows, error: memberError } = await this.supabase.client
      .from('tenant_members')
      .select('tenant_id')
      .in(
        'tenant_id',
        tenants.map((t) => t.id)
      );
    if (memberError) throw memberError;

    const counts = new Map<string, number>();
    for (const row of memberRows ?? []) {
      const tid = (row as { tenant_id: string }).tenant_id;
      counts.set(tid, (counts.get(tid) ?? 0) + 1);
    }

    return tenants.map((t) => ({
      id: t.id as string,
      name: t.name as string,
      subdomain: (t.subdomain as string) ?? null,
      custom_domain: (t.custom_domain as string) ?? null,
      app_display_name: (t.app_display_name as string) ?? (t.name as string),
      primary_color: (t.primary_color as string) ?? '#0d9488',
      logo_url: (t.logo_url as string) ?? null,
      suspended_at: (t.suspended_at as string) ?? null,
      member_count: counts.get(t.id as string) ?? 0,
      created_at: t.created_at as string,
    }));
  }

  async provisionTenant(
    agencyId: string,
    name: string,
    subdomain: string,
    brand: Record<string, unknown> = {}
  ): Promise<{ id: string; name: string; subdomain: string; default_space_id: string }> {
    const { data, error } = await this.supabase.client.rpc('provision_tenant', {
      p_agency_id: agencyId,
      p_name: name,
      p_subdomain: subdomain,
      p_brand: brand,
    });
    if (error) throw error;
    return data as { id: string; name: string; subdomain: string; default_space_id: string };
  }

  async checkSubdomainAvailable(subdomain: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('check_subdomain_available', {
      p_subdomain: subdomain,
    });
    if (error) throw error;
    return data === true;
  }

  // ---------------------------------------------------------------------------
  // tenant branding (from agency portal)
  // ---------------------------------------------------------------------------

  async updateTenantBranding(
    tenantId: string,
    branding: TenantBrandingUpdate
  ): Promise<{ id: string; updated: boolean }> {
    const { data, error } = await this.supabase.client.rpc('update_tenant_branding', {
      p_tenant_id: tenantId,
      p_branding: branding,
    });
    if (error) throw error;
    return data as { id: string; updated: boolean };
  }

  async getTenantBranding(tenantId: string): Promise<TenantBrandFields> {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .select(
        'id, name, subdomain, custom_domain, app_display_name, logo_url, favicon_url, primary_color, accent_color, email_from_name, suspended_at'
      )
      .eq('id', tenantId)
      .single();
    if (error) throw error;
    return data as TenantBrandFields;
  }

  async createTenantInvite(
    tenantId: string,
    email: string,
    role: 'owner' | 'member' = 'owner'
  ): Promise<void> {
    const code = this.generateCode();
    const userId = (await this.supabase.client.auth.getUser()).data.user?.id;
    if (!userId) throw new Error('Not authenticated');
    const { error } = await this.supabase.client
      .from('tenant_invites')
      .insert({
        tenant_id: tenantId,
        email,
        role,
        invite_code: code,
        created_by: userId,
      });
    if (error) throw error;
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
