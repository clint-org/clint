-- migration: 20260525100700_rpc_ai_call_close
-- purpose: worker-callable RPC that finalizes an ai_calls row after the LLM
--          call returns or fails. sets outcome, tokens, cost, duration, output.

create or replace function public.ai_call_close(
  p_secret            text,
  p_ai_call_id        uuid,
  p_outcome           text,
  p_prompt_tokens     int     default null,
  p_completion_tokens int     default null,
  p_cost_cents        numeric default null,
  p_duration_ms       int     default null,
  p_output            jsonb   default null,
  p_warnings          jsonb   default null,
  p_error_code        text    default null,
  p_error_message     text    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_outcome text;
begin
  perform public._verify_extract_source_worker_secret(p_secret);

  select outcome into v_current_outcome
    from public.ai_calls
   where id = p_ai_call_id;

  if v_current_outcome is null then
    raise exception 'ai_call % not found', p_ai_call_id
      using errcode = 'P0002';
  end if;

  if v_current_outcome <> 'pending' then
    raise exception 'ai_call % already closed with outcome %', p_ai_call_id, v_current_outcome
      using errcode = '22023';
  end if;

  update public.ai_calls
     set outcome           = p_outcome,
         prompt_tokens     = p_prompt_tokens,
         completion_tokens = p_completion_tokens,
         cost_estimate_cents = p_cost_cents,
         duration_ms       = p_duration_ms,
         output            = p_output,
         warnings          = p_warnings,
         error_code        = p_error_code,
         error_message     = p_error_message,
         closed_at         = now()
   where id = p_ai_call_id;
end;
$$;

revoke execute on function public.ai_call_close(text, uuid, text, int, int, numeric, int, jsonb, jsonb, text, text) from public;
grant execute on function public.ai_call_close(text, uuid, text, int, int, numeric, int, jsonb, jsonb, text, text) to anon;

comment on function public.ai_call_close(text, uuid, text, int, int, numeric, int, jsonb, jsonb, text, text) is
  'Worker-callable. Closes a pending ai_calls row with outcome, tokens, cost, output.';

-- smoke test
do $$
declare
  v_tid uuid;
  v_sid uuid;
  v_uid uuid;
  v_id  uuid;
  v_threw boolean := false;
begin
  select t.id, s.id into v_tid, v_sid
    from public.tenants t
    join public.spaces s on s.tenant_id = t.id
    limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tid is null or v_uid is null then
    raise notice 'smoke: no tenants/users, skipping ai_call_close smoke';
    return;
  end if;

  v_id := public.ai_call_open(
    'local-dev-extract-source-secret',
    v_tid, v_sid, v_uid,
    'claude-sonnet-4-6', 'source_extract'
  );

  perform public.ai_call_close(
    'local-dev-extract-source-secret',
    v_id, 'success',
    p_prompt_tokens := 100,
    p_completion_tokens := 50,
    p_cost_cents := 0.0150,
    p_duration_ms := 3200
  );

  assert exists (
    select 1 from public.ai_calls
     where id = v_id and outcome = 'success' and closed_at is not null
  ), 'ai_call not closed properly';

  begin
    perform public.ai_call_close(
      'local-dev-extract-source-secret',
      v_id, 'success'
    );
  exception when sqlstate '22023' then
    v_threw := true;
  end;
  assert v_threw, 'double close should raise 22023';

  delete from public.ai_calls where id = v_id;
  raise notice 'smoke: ai_call_close OK';
end$$;
