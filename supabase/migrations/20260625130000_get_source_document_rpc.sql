-- migration: 20260625130000_get_source_document_rpc
-- purpose: expose import provenance to space curators. Given a source_doc_id
--          (carried by every AI-imported company/asset/trial/marker/event),
--          return the source_documents row -- raw ingested text, title, URL,
--          fetch outcome -- plus the importer's email (resolved from auth.users
--          via the definer context) and the model from the linked ai_call.
--
-- Access: space owners and editors only (viewers and non-members rejected with
--          42501). has_space_access already grants platform admin a read bypass.
-- This keeps source_documents itself "dark" (its RLS stays agency-only); this
-- RPC is the single controlled read path for tenant-side curators, modeled on
-- get_ai_call_detail. Read-only, so no @audit:tier1 marker applies.

create or replace function public.get_source_document(
  p_source_doc_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_result   jsonb;
begin
  -- Resolve the owning space. Unknown / deleted id -> null (the caller renders
  -- nothing); do not raise, and do not leak via a distinct error.
  select space_id into v_space_id
    from public.source_documents
   where id = p_source_doc_id;

  if v_space_id is null then
    return null;
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'source_doc_id', sd.id,
    'space_id', sd.space_id,
    'source_title', sd.source_title,
    'source_kind', sd.source_kind,
    'source_url', sd.source_url,
    'source_text', sd.source_text,
    'fetched_at', sd.fetched_at,
    'fetch_outcome', sd.fetch_outcome,
    'created_at', sd.created_at,
    'imported_by_email', u.email,
    -- model + outcome from the import's linked ai_call (best-effort, nullable).
    'ai_model', ac.model,
    'ai_outcome', ac.outcome
  )
  into v_result
  from public.source_documents sd
  left join auth.users u on u.id = sd.created_by
  left join lateral (
    select model, outcome
      from public.ai_calls
     where source_doc_id = sd.id
     order by created_at desc
     limit 1
  ) ac on true
  where sd.id = p_source_doc_id;

  return v_result;
end;
$$;

revoke execute on function public.get_source_document(uuid) from public;
grant execute on function public.get_source_document(uuid) to authenticated;

-- smoke test
do $$
begin
  assert exists (
    select 1 from pg_proc
     where proname = 'get_source_document'
       and pronamespace = 'public'::regnamespace
  ), 'get_source_document missing';
  raise notice 'smoke: get_source_document OK';
end$$;

notify pgrst, 'reload schema';
