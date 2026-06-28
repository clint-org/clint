-- migration: 20260624150400_rpc_platform_admin_upsert_ai_model_pricing
-- purpose: Tier 1 audited RPC so a platform admin can add a model or change a
--          price/status without a deploy. Because per-call cost is snapshotted at
--          close time, a price change here only affects FUTURE calls -- it never
--          rewrites historical cost. Patch semantics on update; inserts require
--          the not-null fields.

create or replace function public.platform_admin_upsert_ai_model_pricing(
  p_model_id              text,
  p_reason                text,
  p_display_name          text          default null,
  p_family                text          default null,
  p_input_cents_per_mtok  numeric       default null,
  p_output_cents_per_mtok numeric       default null,
  p_status                text          default null,
  p_superseded_by         text          default null,
  p_released_on           date          default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- @audit:tier1
declare
  v_uid  uuid := auth.uid();
  v_row  public.ai_model_pricing;
  v_diff jsonb := '{}'::jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('active', 'deprecated', 'retired') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;
  if p_family is not null and p_family not in ('opus', 'sonnet', 'haiku', 'fable') then
    raise exception 'invalid family: %', p_family using errcode = '22023';
  end if;

  select * into v_row from public.ai_model_pricing where model_id = p_model_id;

  if v_row.model_id is null then
    -- insert path: the not-null columns must be supplied
    if p_display_name is null or p_family is null
       or p_input_cents_per_mtok is null or p_output_cents_per_mtok is null then
      raise exception 'new model requires display_name, family, input + output pricing'
        using errcode = '22023';
    end if;
    insert into public.ai_model_pricing
      (model_id, display_name, family, input_cents_per_mtok, output_cents_per_mtok,
       status, superseded_by, released_on, updated_by, updated_at)
    values
      (p_model_id, p_display_name, p_family, p_input_cents_per_mtok, p_output_cents_per_mtok,
       coalesce(p_status, 'active'), p_superseded_by, p_released_on, v_uid, now());
    v_diff := jsonb_build_object('created', p_model_id);
  else
    -- update path: patch non-null fields, record a field-level diff
    if p_input_cents_per_mtok is not null and p_input_cents_per_mtok is distinct from v_row.input_cents_per_mtok then
      v_diff := v_diff || jsonb_build_object('input_cents_per_mtok',
        jsonb_build_array(v_row.input_cents_per_mtok, p_input_cents_per_mtok));
    end if;
    if p_output_cents_per_mtok is not null and p_output_cents_per_mtok is distinct from v_row.output_cents_per_mtok then
      v_diff := v_diff || jsonb_build_object('output_cents_per_mtok',
        jsonb_build_array(v_row.output_cents_per_mtok, p_output_cents_per_mtok));
    end if;
    if p_status is not null and p_status is distinct from v_row.status then
      v_diff := v_diff || jsonb_build_object('status', jsonb_build_array(v_row.status, p_status));
    end if;
    if p_superseded_by is not null and p_superseded_by is distinct from v_row.superseded_by then
      v_diff := v_diff || jsonb_build_object('superseded_by', jsonb_build_array(v_row.superseded_by, p_superseded_by));
    end if;

    update public.ai_model_pricing
       set display_name          = coalesce(p_display_name, display_name),
           family                = coalesce(p_family, family),
           input_cents_per_mtok  = coalesce(p_input_cents_per_mtok, input_cents_per_mtok),
           output_cents_per_mtok = coalesce(p_output_cents_per_mtok, output_cents_per_mtok),
           status                = coalesce(p_status, status),
           superseded_by         = coalesce(p_superseded_by, superseded_by),
           released_on           = coalesce(p_released_on, released_on),
           updated_by            = v_uid,
           updated_at            = now()
     where model_id = p_model_id;
  end if;

  -- ai_model_pricing has a text PK (no uuid entity id); carry model_id in the
  -- metadata and leave the uuid positional slots null.
  perform public.record_audit_event(
    'ai_model_pricing_updated', 'rpc', 'ai_model_pricing', null, null, null, null,
    jsonb_build_object('reason', p_reason, 'model_id', p_model_id, 'changes', v_diff)
  );

  select * into v_row from public.ai_model_pricing where model_id = p_model_id;
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.platform_admin_upsert_ai_model_pricing(text, text, text, text, numeric, numeric, text, text, date) from public;
grant execute on function public.platform_admin_upsert_ai_model_pricing(text, text, text, text, numeric, numeric, text, text, date) to authenticated;

comment on function public.platform_admin_upsert_ai_model_pricing(text, text, text, text, numeric, numeric, text, text, date) is
  'Tier 1 audited. Platform admin adds a model or changes a price/status. Future calls only -- historical cost is snapshotted per call.';

-- smoke test
do $$
declare
  v_uid uuid;
  v_was_admin boolean;
  v_res jsonb;
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'smoke: no users, skipping upsert_ai_model_pricing smoke';
    return;
  end if;

  v_was_admin := exists (select 1 from public.platform_admins where user_id = v_uid);
  insert into public.platform_admins (user_id) values (v_uid) on conflict do nothing;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);

  -- price change on an existing model
  v_res := public.platform_admin_upsert_ai_model_pricing(
    'claude-sonnet-4-6', 'price update', p_input_cents_per_mtok := 350);
  assert (v_res->>'input_cents_per_mtok')::numeric = 350,
    format('expected input price 350, got %s', v_res);

  -- restore + add a new model
  perform public.platform_admin_upsert_ai_model_pricing(
    'claude-sonnet-4-6', 'restore', p_input_cents_per_mtok := 300);
  v_res := public.platform_admin_upsert_ai_model_pricing(
    'claude-test-1', 'add model', p_display_name := 'Test', p_family := 'haiku',
    p_input_cents_per_mtok := 10, p_output_cents_per_mtok := 50);
  assert (v_res->>'model_id') = 'claude-test-1', 'new model not inserted';

  -- new model missing required fields -> error
  begin
    perform public.platform_admin_upsert_ai_model_pricing('claude-test-2', 'bad');
    raise exception 'expected missing-fields failure';
  exception when sqlstate '22023' then null;
  end;

  delete from public.ai_model_pricing where model_id = 'claude-test-1';
  if not v_was_admin then delete from public.platform_admins where user_id = v_uid; end if;
  raise notice 'smoke: platform_admin_upsert_ai_model_pricing OK';
end$$;

notify pgrst, 'reload schema';
