import { inject, Injectable } from '@angular/core';

import {
  Agency,
  AgencyMember,
  AgencyBrandingUpdate,
  AgencyTenantSummary,
  BrandfetchResult,
  TenantBrandFields,
  TenantBrandingUpdate,
} from '../models/agency.model';
import { SupabaseService } from './supabase.service';
import { clearBrandCache, broadcastBrandInvalidation } from '../util/brand-bootstrap';

@Injectable({ providedIn: 'root' })
export class AgencyService {
  private supabase = inject(SupabaseService);

  // ---------------------------------------------------------------------------
  // agencies
  // ---------------------------------------------------------------------------

  async listMyAgencies(): Promise<Agency[]> {
    const { data } = await this.supabase.client
      .from('agencies')
      .select('*')
      .order('created_at')
      .throwOnError();
    return data ?? [];
  }

  async getAgency(id: string): Promise<Agency> {
    const { data } = await this.supabase.client
      .from('agencies')
      .select('*')
      .eq('id', id)
      .single()
      .throwOnError();
    return data;
  }

  async updateAgencyBranding(
    id: string,
    branding: AgencyBrandingUpdate
  ): Promise<{ id: string; updated: boolean }> {
    const { data } = await this.supabase.client
      .rpc('update_agency_branding', {
        p_agency_id: id,
        p_branding: branding,
      })
      .throwOnError();
    if (typeof window !== 'undefined') {
      clearBrandCache(window.location.host);
      broadcastBrandInvalidation(window.location.host);
    }
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
      const { data: rawData } = await this.supabase.client
        .from('agency_members')
        .select('*')
        .eq('agency_id', agencyId)
        .order('created_at')
        .throwOnError();
      return rawData ?? [];
    }
    return data ?? [];
  }

  async addAgencyMember(
    agencyId: string,
    userId: string,
    role: 'owner' | 'member'
  ): Promise<AgencyMember> {
    const { data } = await this.supabase.client
      .from('agency_members')
      .insert({ agency_id: agencyId, user_id: userId, role })
      .select()
      .single()
      .throwOnError();
    return data as AgencyMember;
  }

  /**
   * Symmetric add-by-email. Calls `add_agency_member` RPC which handles both
   * existing-user (direct insert into agency_members) and unknown-email (held
   * agency_invites row, auto-promoted by handle_new_user on first sign-in).
   * Mirrors `add_tenant_owner` shape.
   */
  async addAgencyMemberByEmail(
    agencyId: string,
    email: string,
    role: 'owner' | 'member'
  ): Promise<{
    member_invited: boolean;
    user_id?: string;
    invite_id?: string;
    email?: string;
  }> {
    const { data } = await this.supabase.client
      .rpc('add_agency_member', {
        p_agency_id: agencyId,
        p_email: email,
        p_role: role,
      })
      .throwOnError();
    return data as {
      member_invited: boolean;
      user_id?: string;
      invite_id?: string;
      email?: string;
    };
  }

  async removeAgencyMember(memberId: string): Promise<void> {
    await this.supabase.client.from('agency_members').delete().eq('id', memberId).throwOnError();
  }

  async updateAgencyMemberRole(memberId: string, role: 'owner' | 'member'): Promise<void> {
    await this.supabase.client
      .from('agency_members')
      .update({ role })
      .eq('id', memberId)
      .throwOnError();
  }

  /**
   * Resolve an email to a user_id via the lookup_user_by_email RPC.
   * Returns null when the email isn't registered (not an error condition --
   * the UI should offer "send invite" as the alternative).
   */
  async lookupUserByEmail(
    email: string
  ): Promise<{ user_id: string; display_name: string } | null> {
    const { data } = await this.supabase.client
      .rpc('lookup_user_by_email', {
        p_email: email,
      })
      .throwOnError();
    const result = data as { found: boolean; user_id?: string; display_name?: string };
    if (!result?.found || !result.user_id) return null;
    return { user_id: result.user_id, display_name: result.display_name ?? email };
  }

  // ---------------------------------------------------------------------------
  // tenants under an agency
  // ---------------------------------------------------------------------------

  async listAgencyTenants(agencyId: string): Promise<AgencyTenantSummary[]> {
    const { data } = await this.supabase.client
      .from('tenants')
      .select(
        'id, name, subdomain, custom_domain, app_display_name, primary_color, logo_url, suspended_at, created_at'
      )
      .eq('agency_id', agencyId)
      .order('created_at')
      .throwOnError();

    // Fetch member counts in a separate query (pragmatic v1 — fine for <50 tenants).
    const tenants = data ?? [];
    if (tenants.length === 0) return [];

    const { data: memberRows } = await this.supabase.client
      .from('tenant_members')
      .select('tenant_id')
      .in(
        'tenant_id',
        tenants.map((t) => t.id)
      )
      .throwOnError();

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
    const { data } = await this.supabase.client
      .rpc('provision_tenant', {
        p_agency_id: agencyId,
        p_name: name,
        p_subdomain: subdomain,
        p_brand: brand,
      })
      .throwOnError();
    return data as { id: string; name: string; subdomain: string; default_space_id: string };
  }

  async checkSubdomainAvailable(subdomain: string): Promise<boolean> {
    const { data } = await this.supabase.client
      .rpc('check_subdomain_available', {
        p_subdomain: subdomain,
      })
      .throwOnError();
    return data === true;
  }

  // ---------------------------------------------------------------------------
  // tenant branding (from agency portal)
  // ---------------------------------------------------------------------------

  async updateTenantBranding(
    tenantId: string,
    branding: TenantBrandingUpdate
  ): Promise<{ id: string; updated: boolean }> {
    const { data } = await this.supabase.client
      .rpc('update_tenant_branding', {
        p_tenant_id: tenantId,
        p_branding: branding,
      })
      .throwOnError();
    if (typeof window !== 'undefined') {
      clearBrandCache(window.location.host);
      broadcastBrandInvalidation(window.location.host);
    }
    return data as { id: string; updated: boolean };
  }

  async getTenantBranding(tenantId: string): Promise<TenantBrandFields> {
    const { data } = await this.supabase.client
      .from('tenants')
      .select(
        'id, name, subdomain, custom_domain, app_display_name, logo_url, favicon_url, primary_color, email_from_name, suspended_at'
      )
      .eq('id', tenantId)
      .single()
      .throwOnError();
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
    await this.supabase.client
      .from('tenant_invites')
      .insert({
        tenant_id: tenantId,
        email,
        role,
        invite_code: code,
        created_by: userId,
      })
      .throwOnError();
  }

  // ---------------------------------------------------------------------------
  // brandfetch
  // ---------------------------------------------------------------------------

  async fetchBrandFromDomain(domain: string): Promise<BrandfetchResult> {
    const session = (await this.supabase.client.auth.getSession()).data.session;
    const apiBase = (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE ?? '';
    const res = await fetch(`${apiBase}/api/brandfetch/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `brandfetch lookup failed (${res.status})`);
    }
    return (await res.json()) as BrandfetchResult;
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
