export type BrandKind = 'tenant' | 'agency' | 'super-admin' | 'default';

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
}
