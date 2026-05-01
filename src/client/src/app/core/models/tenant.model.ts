export interface Tenant {
  id: string;
  name: string;
  slug: string;
  subdomain: string;
  custom_domain: string | null;
  logo_url: string | null;
  agency_id: string | null;
  /** Per-tenant maximum size (bytes) for engagement materials. */
  material_max_size_bytes?: number;
  /** Per-tenant allowlist of mime types accepted by register_material. */
  material_allowed_mime_types?: string[];
  created_at: string;
  updated_at: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner';
  created_at: string;
  email?: string;
  display_name?: string;
  is_agency_backed?: boolean;
}

export interface TenantInvite {
  id: string;
  tenant_id: string;
  email: string;
  role: 'owner';
  invite_code: string;
  created_by: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}
