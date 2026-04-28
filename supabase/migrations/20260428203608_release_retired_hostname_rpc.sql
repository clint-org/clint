-- migration: 20260428203608_release_retired_hostname_rpc
-- purpose: super-admin lever to immediately release a hostname from the
--   retired_hostnames holdback. retired_hostnames is populated automatically
--   by the AFTER UPDATE/DELETE trigger on tenants and agencies (see
--   20260428040300_whitelabel_hostname_retirement_triggers) so that recently
--   decommissioned hostnames cannot be re-claimed for 90 days. that safety
--   net is correct for the customer-decommission case (prevents takeover via
--   stale session cookies, bookmarked invite URLs, outbound email links),
--   but it gets in the way of super-admin cleanup and re-provisioning.
--   release_retired_hostname() is the explicit override path: deletes the
--   holdback row so the hostname is immediately available again.
--
--   also corrects the doc comment on delete_agency, which previously claimed
--   to "skip retired_hostnames holdback" — it does not, the agency-DELETE
--   trigger fires inside the same transaction and inserts the holdback row
--   regardless of the calling RPC. super-admins who want to re-use the
--   subdomain immediately must follow up with release_retired_hostname().
--
-- affected objects:
--   public.release_retired_hostname (new function)
--   public.delete_agency            (comment correction only)

create or replace function public.release_retired_hostname(p_hostname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hostname text := lower(trim(coalesce(p_hostname, '')));
  v_row      record;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;
  if v_hostname = '' then
    raise exception 'Hostname required' using errcode = 'P0001';
  end if;

  delete from public.retired_hostnames
   where hostname = v_hostname
   returning hostname, previous_kind, previous_id, retired_at, released_at
   into v_row;

  if v_row.hostname is null then
    raise exception 'Hostname "%" is not in the holdback list', v_hostname
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'hostname',      v_row.hostname,
    'previous_kind', v_row.previous_kind,
    'previous_id',   v_row.previous_id,
    'retired_at',    v_row.retired_at,
    'released_at',   v_row.released_at
  );
end;
$$;

comment on function public.release_retired_hostname(text) is
  'Platform-admin-only override. Deletes the named hostname from '
  'retired_hostnames so it can be immediately re-claimed. Use after a '
  'super-admin delete_agency / delete_tenant when you want to reuse the '
  'subdomain without waiting for the 90-day holdback. Always raises if '
  'the hostname is not currently in the holdback list, so callers do not '
  'silently no-op on typos.';

revoke execute on function public.release_retired_hostname(text) from public, anon;
grant  execute on function public.release_retired_hostname(text) to authenticated;

-- correct the misleading comment on delete_agency; the body is unchanged.
comment on function public.delete_agency(uuid) is
  'Platform-admin-only destructive RPC. Deletes an agency and cascades to '
  'its agency_members and agency_invites rows. Refuses if any tenants are '
  'still attached. Note: the AFTER DELETE trigger on agencies still inserts '
  'the agency''s subdomain into retired_hostnames (90-day holdback). Call '
  'release_retired_hostname() after delete_agency to immediately free the '
  'subdomain for re-provisioning.';
