export type BrandKind = 'tenant' | 'agency' | 'super-admin' | 'default';

/**
 * Public-safe descriptor for the agency that provisioned a tenant. Surfaced
 * on tenant brands only, so the login screen and app shell can show
 * "intelligence delivered by {agency}" framing -- the value prop is that
 * the agency is the analyst behind the workspace, even though the chrome
 * inside the app stays tenant-branded.
 */
export interface BrandAgency {
  name: string;
  logo_url: string | null;
}

export interface Brand {
  kind: BrandKind;
  id: string | null;
  app_display_name: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  auth_providers: string[];
  has_self_join: boolean;
  suspended: boolean;
  /** Only populated when kind === 'tenant' AND the tenant has an agency. */
  agency: BrandAgency | null;
}
