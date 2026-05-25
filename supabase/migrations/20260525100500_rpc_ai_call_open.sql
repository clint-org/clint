-- migration: 20260525100500_rpc_ai_call_open
-- purpose: worker-callable RPC that inserts a pending ai_calls row before the
--          LLM is invoked. returns the ai_call_id for later close.

create or replace function public.ai_call_open(
  p_secret      text,
  p_tenant_id   uuid,
  p_space_id    uuid,
  p_user_id     uuid,
  p_model       text,
  p_feature     text,
  p_input_hash  text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._verify_extract_source_worker_secret(p_secret);

  insert into public.ai_calls (
    tenant_id, space_id, user_id, provider, model, feature,
    outcome, input_hash
  ) values (
    p_tenant_id, p_space_id, p_user_id, 'anthropic', p_model, p_feature,
    'pending', p_input_hash
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.ai_call_open(text, uuid, uuid, uuid, text, text, text) from public;
grant execute on function public.ai_call_open(text, uuid, uuid, uuid, text, text, text) to anon;

comment on function public.ai_call_open(text, uuid, uuid, uuid, text, text, text) is
  'Worker-callable. Opens a pending ai_calls row before the LLM call. Returns the ai_call_id.';

-- smoke test
do $$
declare
  v_tid uuid;
  v_sid uuid;
  v_uid uuid;
  v_id  uuid;
begin
  select t.id, s.id into v_tid, v_sid
    from public.tenants t
    join public.spaces s on s.tenant_id = t.id
    limit 1;
  if v_tid is null then
    raise notice 'smoke: no tenants/spaces, skipping ai_call_open smoke';
    return;
  end if;

  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'smoke: no users, skipping ai_call_open smoke';
    return;
  end if;

  v_id := public.ai_call_open(
    'local-dev-extract-source-secret',
    v_tid, v_sid, v_uid,
    'claude-sonnet-4-6', 'source_extract'
  );

  assert v_id is not null, 'ai_call_open returned null';
  assert exists (
    select 1 from public.ai_calls where id = v_id and outcome = 'pending'
  ), 'ai_calls row not found or wrong outcome';

  delete from public.ai_calls where id = v_id;
  raise notice 'smoke: ai_call_open OK';
end$$;
