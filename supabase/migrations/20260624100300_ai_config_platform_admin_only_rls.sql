-- migration: 20260624100300_ai_config_platform_admin_only_rls
-- purpose: Cost caps and rate limits in ai_config drive Clint's own Anthropic
--          spend, so tenant owners must not be able to read the dollar caps or
--          write any field directly over PostgREST. Lock all direct table access
--          to platform admins. Tenant owners/members now go through SECURITY
--          DEFINER RPCs:
--            - tenant_owner_update_ai_config  (on/off only)
--            - platform_admin_update_ai_config (full config, admins)
--            - get_tenant_ai_status            (owner-safe read, percentage not cents)
--          The worker keeps reading via ai_call_preflight (SECURITY DEFINER).

drop policy if exists "tenant owner or platform admin can read ai_config"   on public.ai_config;
drop policy if exists "tenant owner or platform admin can update ai_config" on public.ai_config;
drop policy if exists "tenant owner can delete ai_config"                   on public.ai_config;

create policy "platform admin can read ai_config"
  on public.ai_config for select to authenticated
  using ((select public.is_platform_admin()));

create policy "platform admin can update ai_config"
  on public.ai_config for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

create policy "platform admin can delete ai_config"
  on public.ai_config for delete to authenticated
  using ((select public.is_platform_admin()));

-- smoke test: a non-admin authenticated user must see zero rows directly, but the
-- SECURITY DEFINER read path must still surface ai_enabled to them.
do $$
declare
  v_tid     uuid;
  v_uid     uuid;
  v_count   int;
  v_status  jsonb;
begin
  select id into v_tid from public.tenants limit 1;
  select u.id into v_uid
    from auth.users u
   where not exists (select 1 from public.platform_admins pa where pa.user_id = u.id)
   limit 1;
  if v_tid is null or v_uid is null then
    raise notice 'smoke: no tenants/non-admin users, skipping ai_config RLS smoke';
    return;
  end if;

  insert into public.ai_config (tenant_id, ai_enabled)
    values (v_tid, true)
    on conflict (tenant_id) do update set ai_enabled = true;

  -- give the user space-level access to the tenant so get_tenant_ai_status works,
  -- but NOT tenant-owner or platform-admin (so direct RLS select is denied)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);
  set local role authenticated;

  select count(*) into v_count from public.ai_config where tenant_id = v_tid;
  assert v_count = 0,
    format('expected 0 directly-visible ai_config rows for non-admin, got %s', v_count);

  reset role;
  delete from public.ai_config where tenant_id = v_tid;
  raise notice 'smoke: ai_config platform-admin-only RLS OK';
end$$;

notify pgrst, 'reload schema';
