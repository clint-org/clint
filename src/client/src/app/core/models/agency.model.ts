export interface Agency {
  id: string;
  name: string;
  slug: string;
  subdomain: string;
  logo_url: string | null;
  favicon_url: string | null;
  app_display_name: string;
  primary_color: string;
  contact_email: string;
  plan_tier: string;
  max_tenants: number;
  custom_domain: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgencyMember {
  id: string;
  agency_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
  email?: string;
  display_name?: string;
}

export interface AgencyTenantSummary {
  id: string;
  name: string;
  subdomain: string | null;
  custom_domain: string | null;
  app_display_name: string;
  primary_color: string;
  logo_url: string | null;
  suspended_at: string | null;
  member_count: number;
  created_at: string;
}

export interface AgencyBrandingUpdate {
  app_display_name?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string;
  contact_email?: string;
}

export interface TenantBrandingUpdate {
  app_display_name?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string;
  email_from_name?: string;
}

export interface TenantBrandFields {
  id: string;
  name: string;
  subdomain: string | null;
  custom_domain: string | null;
  app_display_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  email_from_name: string | null;
  suspended_at: string | null;
}
