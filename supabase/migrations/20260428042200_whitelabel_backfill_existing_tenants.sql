-- migration: 20260428042200_whitelabel_backfill_existing_tenants
-- purpose: legacy tenants (created before whitelabel) have null subdomain,
--   null app_display_name, and the schema-default primary_color. give them
--   sensible defaults so they can opt into a subdomain via tenant settings
--   later without breaking get_brand_by_host or theme bootstrap.
-- subdomain := slug (slug is already DNS-safe per existing migrations).
-- app_display_name := name.
-- primary_color := '#0d9488' (already the column default; no-op for new
--   rows but explicit here for clarity).
-- skips tenants that already have a non-null subdomain.

update public.tenants
   set subdomain        = coalesce(subdomain, slug),
       app_display_name = coalesce(app_display_name, name),
       primary_color    = coalesce(primary_color, '#0d9488'),
       email_from_name  = coalesce(email_from_name, app_display_name, name)
 where subdomain is null
    or app_display_name is null
    or email_from_name is null;
