-- Drop legacy self-provisioning RPCs.
--
-- Under the whitelabel access model, tenants belong to an agency and are
-- provisioned via public.provision_tenant() by an agency owner or platform
-- admin. The two RPCs dropped here let any authenticated user spawn an
-- agency-less ("orphan") tenant from /onboarding or /provision-demo, which
-- bypassed the agency hierarchy and produced tenants with no subdomain
-- (the `-4fd31044`-suffixed orphans cleaned up on 2026-04-30 came from this).
--
-- Dropped:
--   public.create_tenant(text, text)    -- onboarding "Create Tenant" tab
--   public.provision_demo_workspace()   -- /provision-demo route
--
-- Direct-customer (no-agency) tenant provisioning, if needed later, will be
-- added as a platform-admin-only branch on public.provision_tenant().

drop function if exists public.create_tenant(text, text);
drop function if exists public.provision_demo_workspace();
