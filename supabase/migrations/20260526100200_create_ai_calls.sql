-- migration: 20260525100200_create_ai_calls
-- purpose: every LLM call, regardless of outcome. The AI audit trail.
--          written by worker-callable RPCs (ai_call_open, ai_call_close).
--          agency-only visibility.

create table public.ai_calls (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  space_id             uuid not null references public.spaces(id) on delete cascade,
  user_id              uuid not null references auth.users(id),
  source_doc_id        uuid references public.source_documents(id) on delete set null,
  provider             text not null default 'anthropic',
  model                text not null,
  feature              text not null,
  prompt_tokens        int,
  completion_tokens    int,
  cost_estimate_cents  numeric(10,4),
  duration_ms          int,
  outcome              text not null check (outcome in
    ('pending', 'success', 'fetch_failed', 'parse_failed', 'timeout',
     'cost_capped', 'rate_limited', 'cancelled')),
  input_hash           text,
  output               jsonb,
  warnings             jsonb,
  error_code           text,
  error_message        text,
  created_at           timestamptz not null default now(),
  closed_at            timestamptz
);

create index idx_ai_calls_tenant_created
  on public.ai_calls (tenant_id, created_at desc);

create index idx_ai_calls_space_user_created
  on public.ai_calls (space_id, user_id, created_at desc);

alter table public.ai_calls enable row level security;

create policy "agency members or platform admin can read ai_calls"
  on public.ai_calls for select to authenticated
  using (
    public.is_agency_member_of_space(space_id)
    or public.is_platform_admin()
  );

create policy "platform admin can delete ai_calls"
  on public.ai_calls for delete to authenticated
  using (public.is_platform_admin());

-- smoke test
do $$
begin
  assert exists (
    select 1 from information_schema.check_constraints
     where constraint_name = 'ai_calls_outcome_check'
  ), 'outcome check constraint missing';

  raise notice 'smoke: ai_calls table OK';
end$$;
