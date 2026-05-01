-- Broaden the tenants SELECT RLS policy so space-only members can read
-- their parent tenant's identity row (name, subdomain, brand fields).
--
-- Why: a pure space-only member (e.g. a Reader added via space-invite,
-- with no tenant_members row) sees an empty topbar tenant dropdown when
-- inside their space. The dropdown is fed by `select * from tenants`,
-- which the previous policy filtered to zero rows for them. Verified
-- 2026-05-01 via curl during the access-model test pass:
-- `GET /rest/v1/tenants` returned [] for a space-only Reader who had
-- full access to a space in that tenant.
--
-- Why this is safe: the tenants row exposes brand identity (name,
-- subdomain, custom_domain, app_display_name, primary_color, logo_url,
-- agency_id, suspended_at). All of this is already visible to a
-- space-only member through the brand bootstrap (they enter via the
-- tenant subdomain and see the brand applied). Broadening tenant SELECT
-- only confirms what they can already infer; it does not leak owners,
-- members, or operational state.
--
-- Why we DO NOT call public.has_tenant_access here: that function is
-- documented as a route-guard helper, not for RLS. Using it would risk
-- a future broadening of `has_tenant_access` accidentally widening RLS
-- on tenant_members or other tenant-internal tables. The disjunct is
-- inlined instead so the policy is self-describing.

drop policy if exists "tenant or agency or platform reads" on public.tenants;

create policy "tenant or agency or platform or space-member reads"
on public.tenants for select to authenticated
using (
  public.is_tenant_member(id)
  or (agency_id is not null and public.is_agency_member(agency_id))
  or public.is_platform_admin()
  or exists (
    select 1
    from public.space_members sm
    join public.spaces s on s.id = sm.space_id
    where s.tenant_id = public.tenants.id
      and sm.user_id = auth.uid()
  )
);
