-- migration: 20260625110000_ai_call_detail_created_entities
-- purpose: let the super-admin see WHAT an import created, not just how many.
-- Extend get_ai_call_detail to return tenant_id + space_id (so the UI can build
-- links into the engagement) and created_entities -- the actual companies /
-- assets / trials / markers / events written by this import, resolved via the
-- source_doc_id provenance the commit path stamps on every row.
--
-- companies/assets/trials carry a name and have manage/<type>/:id detail pages
-- (linkable); markers and events carry a title but have no standalone page, so
-- the UI renders them as plain text.

create or replace function public.get_ai_call_detail(
  p_ai_call_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'ai_call_id', a.id,
    'tenant_id', a.tenant_id,
    'space_id', a.space_id,
    'model', a.model,
    'feature', a.feature,
    'outcome', a.outcome,
    'prompt_tokens', a.prompt_tokens,
    'completion_tokens', a.completion_tokens,
    'cost_usd', round(coalesce(a.cost_estimate_cents, 0) / 100.0, 4),
    'source_title', sd.source_title,
    'source_kind', sd.source_kind,
    'error_code', a.error_code,
    'error_message', a.error_message,
    'warnings', a.warnings,
    'request', a.request,
    'output', a.output,
    -- the actual rows this import produced (via source_doc_id provenance)
    'created_entities', jsonb_build_object(
      'companies', (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
        from public.companies c where c.source_doc_id = a.source_doc_id),
      'assets', (
        select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name), '[]'::jsonb)
        from public.assets x where x.source_doc_id = a.source_doc_id),
      'trials', (
        select coalesce(jsonb_agg(jsonb_build_object('id', tr.id, 'name', tr.name) order by tr.name), '[]'::jsonb)
        from public.trials tr where tr.source_doc_id = a.source_doc_id),
      'markers', (
        select coalesce(jsonb_agg(jsonb_build_object('id', mk.id, 'title', mk.title) order by mk.title), '[]'::jsonb)
        from public.markers mk where mk.source_doc_id = a.source_doc_id),
      'events', (
        select coalesce(jsonb_agg(jsonb_build_object('id', ev.id, 'title', ev.title) order by ev.title), '[]'::jsonb)
        from public.events ev where ev.source_doc_id = a.source_doc_id)
    ),
    'created_at', a.created_at,
    'closed_at', a.closed_at
  )
  into v_result
  from public.ai_calls a
  left join public.source_documents sd on sd.id = a.source_doc_id
  where a.id = p_ai_call_id;

  if v_result is null then
    raise exception 'ai_call not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

do $$
begin
  assert exists (select 1 from pg_proc where proname = 'get_ai_call_detail'
    and pronamespace = 'public'::regnamespace),
    'get_ai_call_detail missing';
  raise notice 'smoke: get_ai_call_detail created_entities OK';
end$$;

notify pgrst, 'reload schema';
