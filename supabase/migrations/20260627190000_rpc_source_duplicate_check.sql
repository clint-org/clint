-- migration: 20260627190000_rpc_source_duplicate_check
-- purpose: worker-callable pre-extraction duplicate guard. Lets the source
--          extract worker detect that a byte-identical source was already
--          committed in this space BEFORE spending a Claude call. Mirrors the
--          commit-stage text_hash check in commit_source_import, but runs at
--          extraction time so an exact re-import can short-circuit with a
--          duplicate_source response instead of re-extracting.
--
--          Secret-gated and SECURITY DEFINER (same pattern as ai_call_open) so
--          it can read source_documents -- whose RLS is agency-only -- from the
--          worker without a user JWT. Returns the existing source_documents.id
--          for the oldest match, or null when the hash has never been committed.

create or replace function public.source_duplicate_check(
  p_secret    text,
  p_space_id  uuid,
  p_text_hash text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._verify_extract_source_worker_secret(p_secret);

  select id into v_id
    from public.source_documents
   where space_id = p_space_id
     and text_hash = p_text_hash
   order by created_at asc
   limit 1;

  return v_id;
end;
$$;

revoke execute on function public.source_duplicate_check(text, uuid, text) from public;
grant execute on function public.source_duplicate_check(text, uuid, text) to anon;

comment on function public.source_duplicate_check(text, uuid, text) is
  'Worker-callable. Returns the id of an already-committed source_documents row matching (space_id, text_hash), or null. Lets the extract worker short-circuit an exact re-import before the LLM call.';

-- smoke test (reads actual vault value so it works on both local and remote)
do $$
declare
  v_secret text;
  v_sid uuid;
  v_id  uuid;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'extract_source_worker_secret';
  if v_secret is null then
    raise notice 'smoke: no extract_source_worker_secret in vault, skipping source_duplicate_check smoke';
    return;
  end if;

  select id into v_sid from public.spaces limit 1;
  if v_sid is null then
    raise notice 'smoke: no spaces, skipping source_duplicate_check smoke';
    return;
  end if;

  -- A hash that cannot exist returns null (no false positive).
  v_id := public.source_duplicate_check(v_secret, v_sid, 'smoke-absent-hash-0000000000000000');
  assert v_id is null, 'source_duplicate_check returned non-null for an absent hash';

  raise notice 'smoke: source_duplicate_check OK';
end$$;

notify pgrst, 'reload schema';
