import { inject, Injectable } from '@angular/core';

import { Agency } from '../models/agency.model';
import { SupabaseService } from './supabase.service';

export interface SuperAdminAgencySummary extends Agency {
  tenant_count: number;
}

export interface SuperAdminTenantSummary {
  id: string;
  agency_id: string | null;
  agency_name: string | null;
  agency_slug: string | null;
  name: string;
  subdomain: string | null;
  custom_domain: string | null;
  app_display_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
  suspended_at: string | null;
  created_at: string;
}

export interface RetiredHostname {
  hostname: string;
  retired_at: string;
  released_at: string;
  previous_kind: 'tenant' | 'agency';
  previous_id: string | null;
}

export interface ProvisionAgencyResult {
  id: string;
  name: string;
  slug: string;
  subdomain: string;
  app_display_name: string;
  created_at: string;
  owner_invited: boolean;
  owner_email: string;
}

export interface RegisterCustomDomainResult {
  id: string;
  custom_domain: string;
  updated: boolean;
}

export interface DeleteAgencyResult {
  id: string;
  name: string;
  subdomain: string;
  members_removed: number;
  invites_removed: number;
}

@Injectable({ providedIn: 'root' })
export class SuperAdminService {
  private supabase = inject(SupabaseService);

  // ---------------------------------------------------------------------------
  // agencies
  // ---------------------------------------------------------------------------

  /**
   * Lists every agency in the install. Platform admins see all rows via RLS.
   * Tenant counts are computed client-side from a parallel `tenants` query so
   * we don't depend on a server-side view.
   */
  async listAllAgencies(): Promise<SuperAdminAgencySummary[]> {
    const { data: agencies, error: agencyError } = await this.supabase.client
      .from('agencies')
      .select('*')
      .order('name');
    if (agencyError) throw agencyError;

    const list = (agencies ?? []) as Agency[];
    if (list.length === 0) return [];

    const { data: tenantRows, error: tenantError } = await this.supabase.client
      .from('tenants')
      .select('agency_id');
    if (tenantError) throw tenantError;

    const counts = new Map<string, number>();
    for (const row of tenantRows ?? []) {
      const aid = (row as { agency_id: string | null }).agency_id;
      if (!aid) continue;
      counts.set(aid, (counts.get(aid) ?? 0) + 1);
    }

    return list.map((a) => ({ ...a, tenant_count: counts.get(a.id) ?? 0 }));
  }

  // ---------------------------------------------------------------------------
  // tenants
  // ---------------------------------------------------------------------------

  /**
   * Lists every tenant across every agency. Joins agencies client-side rather
   * than via a postgres view so the service stays self-contained.
   */
  async listAllTenants(): Promise<SuperAdminTenantSummary[]> {
    const [agencyRes, tenantRes] = await Promise.all([
      this.supabase.client.from('agencies').select('id, name, slug'),
      this.supabase.client
        .from('tenants')
        .select(
          'id, agency_id, name, subdomain, custom_domain, app_display_name, primary_color, logo_url, suspended_at, created_at'
        )
        .order('created_at', { ascending: false }),
    ]);
    if (agencyRes.error) throw agencyRes.error;
    if (tenantRes.error) throw tenantRes.error;

    const agencyMap = new Map<string, { name: string; slug: string }>();
    for (const a of agencyRes.data ?? []) {
      const row = a as { id: string; name: string; slug: string };
      agencyMap.set(row.id, { name: row.name, slug: row.slug });
    }

    return (tenantRes.data ?? []).map((t) => {
      const row = t as {
        id: string;
        agency_id: string | null;
        name: string;
        subdomain: string | null;
        custom_domain: string | null;
        app_display_name: string | null;
        primary_color: string | null;
        logo_url: string | null;
        suspended_at: string | null;
        created_at: string;
      };
      const agency = row.agency_id ? agencyMap.get(row.agency_id) : null;
      return {
        id: row.id,
        agency_id: row.agency_id,
        agency_name: agency?.name ?? null,
        agency_slug: agency?.slug ?? null,
        name: row.name,
        subdomain: row.subdomain,
        custom_domain: row.custom_domain,
        app_display_name: row.app_display_name,
        primary_color: row.primary_color,
        logo_url: row.logo_url,
        suspended_at: row.suspended_at,
        created_at: row.created_at,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // retired hostnames
  // ---------------------------------------------------------------------------

  /**
   * Lists hostnames currently in the holdback window. Pass `includeExpired=true`
   * to also include rows whose `released_at` has already passed.
   */
  async listRetiredHostnames(includeExpired = false): Promise<RetiredHostname[]> {
    let query = this.supabase.client
      .from('retired_hostnames')
      .select('*')
      .order('retired_at', { ascending: false });
    if (!includeExpired) {
      query = query.gt('released_at', new Date().toISOString());
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as RetiredHostname[];
  }

  // ---------------------------------------------------------------------------
  // provisioning
  // ---------------------------------------------------------------------------

  async provisionAgency(
    name: string,
    slug: string,
    subdomain: string,
    ownerEmail: string,
    contactEmail: string | null
  ): Promise<ProvisionAgencyResult> {
    const { data, error } = await this.supabase.client.rpc('provision_agency', {
      p_name: name,
      p_slug: slug,
      p_subdomain: subdomain,
      p_owner_email: ownerEmail,
      p_contact_email: contactEmail,
    });
    if (error) throw error;
    return data as ProvisionAgencyResult;
  }

  async deleteAgency(agencyId: string): Promise<DeleteAgencyResult> {
    const { data, error } = await this.supabase.client.rpc('delete_agency', {
      p_agency_id: agencyId,
    });
    if (error) throw error;
    return data as DeleteAgencyResult;
  }

  async registerCustomDomain(
    tenantId: string,
    customDomain: string
  ): Promise<RegisterCustomDomainResult> {
    const { data, error } = await this.supabase.client.rpc('register_custom_domain', {
      p_tenant_id: tenantId,
      p_custom_domain: customDomain,
    });
    if (error) throw error;
    return data as RegisterCustomDomainResult;
  }

  async checkSubdomainAvailable(subdomain: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('check_subdomain_available', {
      p_subdomain: subdomain,
    });
    if (error) throw error;
    return data === true;
  }

  // ---------------------------------------------------------------------------
  // user lookup
  // ---------------------------------------------------------------------------

  /**
   * Resolves an email to a user id via the lookup_user_by_email RPC. Returns
   * null when the email isn't registered (so the UI can offer "send invite"
   * as the alternative path).
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
}
