-- migration: 20260525100000_create_ai_config
-- purpose: tenant-level AI settings. One row per tenant (1:1 extension table).
--          Controls whether AI features are enabled, model selection, cost caps,
--          and rate limits. Managed by platform admins via platform_admin_set_ai_enabled
--          and eventually by tenant owners via a self-service UI.

create table public.ai_config (
  tenant_id                 uuid primary key references public.tenants(id) on delete cascade,
  ai_enabled                boolean not null default false,
  ai_model                  text not null default 'claude-sonnet-4-6',
  daily_cost_cap_cents      int not null default 500,
  per_call_cost_cap_cents   int not null default 5,
  per_user_rate_per_min     int not null default 6,
  per_user_rate_per_hour    int not null default 60,
  updated_by                uuid references auth.users(id),
  updated_at                timestamptz not null default now()
);

alter table public.ai_config enable row level security;

create policy "tenant owner or platform admin can read ai_config"
  on public.ai_config for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = ai_config.tenant_id
         and tm.user_id = auth.uid()
         and tm.role = 'owner'
    )
  );

create policy "tenant owner or platform admin can update ai_config"
  on public.ai_config for update to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = ai_config.tenant_id
         and tm.user_id = auth.uid()
         and tm.role = 'owner'
    )
  );

create policy "tenant owner can delete ai_config"
  on public.ai_config for delete to authenticated
  using (
    exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = ai_config.tenant_id
         and tm.user_id = auth.uid()
         and tm.role = 'owner'
    )
  );

-- smoke test
do $$
declare
  v_tid uuid;
begin
  select id into v_tid from public.tenants limit 1;
  if v_tid is null then
    raise notice 'smoke: no tenants, skipping ai_config smoke test';
    return;
  end if;

  insert into public.ai_config (tenant_id)
    values (v_tid)
    on conflict (tenant_id) do nothing;

  assert exists (
    select 1 from public.ai_config where tenant_id = v_tid and ai_enabled = false
  ), 'ai_config defaults check failed';

  delete from public.ai_config where tenant_id = v_tid;
  raise notice 'smoke: ai_config table + defaults OK';
end$$;
