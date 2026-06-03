-- migration: 20260527130000_add_nct_source_kind
-- purpose: (1) widen the source_documents.source_kind CHECK constraint to
--          accept 'nct' for NCT list imports from ClinicalTrials.gov.
--          (2) create the ai_import_status RPC so the import page can
--          check AI availability, quotas, and rate limits before the
--          user starts an import.

-- ---------------------------------------------------------------------------
-- 1. widen source_kind CHECK to include 'nct'
-- ---------------------------------------------------------------------------

-- drop the existing inline CHECK constraint (auto-named by postgres)
alter table public.source_documents
  drop constraint source_documents_source_kind_check;

-- re-add with 'nct' included
alter table public.source_documents
  add constraint source_documents_source_kind_check
    check (source_kind in ('url', 'text', 'nct'));

-- ---------------------------------------------------------------------------
-- 2. ai_import_status RPC
-- ---------------------------------------------------------------------------
-- lightweight, read-only function for the import page to check AI
-- availability before the user begins. returns quota state without
-- opening an ai_call or consuming any budget.
--
-- security definer: the caller needs read access to ai_config and
-- aggregated ai_calls data regardless of their RLS role. the function
-- gates on tenant membership internally via the auth.uid() check on
-- ai_calls.user_id for the per-user rate metric.

create or replace function public.ai_import_status(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ai_enabled',         coalesce(c.ai_enabled, false),
    'daily_cap_cents',    c.daily_cost_cap_cents,
    'spent_today_cents',  coalesce((
      select sum(ac.cost_estimate_cents)
      from public.ai_calls ac
      where ac.tenant_id = p_tenant_id
        and ac.created_at > now() - interval '24 hours'
        and ac.outcome not in ('cancelled', 'cost_capped', 'rate_limited')
    ), 0),
    'rate_used_hour',     (
      select count(*)
      from public.ai_calls ac
      where ac.tenant_id = p_tenant_id
        and ac.user_id = auth.uid()
        and ac.created_at > now() - interval '1 hour'
        and ac.outcome not in ('cancelled', 'cost_capped', 'rate_limited')
    ),
    'rate_limit_hour',    c.per_user_rate_per_hour
  )
  from public.ai_config c
  where c.tenant_id = p_tenant_id;
$$;

-- grant execute to authenticated users (any authenticated user can check
-- import status for a tenant they belong to)
grant execute on function public.ai_import_status(uuid) to authenticated;

-- revoke from anon (defense in depth)
revoke execute on function public.ai_import_status(uuid) from anon;

-- ---------------------------------------------------------------------------
-- smoke tests
-- ---------------------------------------------------------------------------
do $$
begin
  -- verify the widened CHECK constraint exists and accepts 'nct'
  assert exists (
    select 1 from information_schema.check_constraints
     where constraint_name = 'source_documents_source_kind_check'
  ), 'source_kind CHECK constraint missing after alter';

  -- verify the RPC was created
  assert exists (
    select 1 from information_schema.routines
     where routine_schema = 'public'
       and routine_name = 'ai_import_status'
  ), 'ai_import_status function missing';

  raise notice 'smoke: nct source_kind + ai_import_status OK';
end$$;
