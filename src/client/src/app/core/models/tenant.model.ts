export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  agency_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
  email?: string;
  display_name?: string;
}

export interface TenantInvite {
  id: string;
  tenant_id: string;
  email: string;
  role: 'owner' | 'member';
  invite_code: string;
  created_by: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}
