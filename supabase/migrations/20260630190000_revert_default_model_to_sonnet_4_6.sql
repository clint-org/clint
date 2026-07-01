-- Revert the stopgap global switch to Claude Sonnet 5 (migration
-- 20260630150000). Sonnet 5 roughly doubled AI source-extraction latency and
-- tripped the worker's LLM timeout on large multi-entity sources (a pharma
-- press release naming several trials), so every tenant was moved back to
-- claude-sonnet-4-6 as a live patch. This migration makes that durable across
-- `db reset` and newly provisioned tenants.
--
-- Sonnet 5 stays active and selectable in ai_model_pricing; only the column
-- default and the current tenant assignments change. The durable model-catalog
-- fix (live Models API sync + refresh/upgrade) is still tracked under #180.

-- 1. New tenants default to Sonnet 4.6 again.
alter table public.ai_config alter column ai_model set default 'claude-sonnet-4-6';

-- 2. Move any tenant still on Sonnet 5 back to Sonnet 4.6.
update public.ai_config
   set ai_model = 'claude-sonnet-4-6'
 where ai_model = 'claude-sonnet-5';

-- 3. Smoke: default restored and no tenant remains on Sonnet 5. Pure SQL (no
--    access-guarded RPCs), so it passes both `db reset` (empty) and `db push`
--    against a populated remote.
do $$
declare
  v_default text;
begin
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'ai_config'
     and column_name = 'ai_model';
  if v_default is null or v_default not like '%claude-sonnet-4-6%' then
    raise exception 'ai_config.ai_model default not restored to claude-sonnet-4-6 (got %)', v_default;
  end if;

  if exists (select 1 from public.ai_config where ai_model = 'claude-sonnet-5') then
    raise exception 'ai_config rows still on claude-sonnet-5';
  end if;
end $$;
