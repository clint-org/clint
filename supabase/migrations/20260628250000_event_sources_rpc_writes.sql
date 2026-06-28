-- migration: 20260628250000_event_sources_rpc_writes
-- purpose: wire the event_sources WRITE paths for the unified event model (S1b).
--   1. create_event gains a trailing `p_sources jsonb default null` param and
--      inserts the supplied sources into public.event_sources atomically inside
--      its existing SECURITY DEFINER transaction. ADDITIVE: every existing
--      param (including p_source_url) and the entire prior body are preserved
--      byte-identical; only the source insert and the new param are added. A
--      DROP+CREATE is required (adding a param would otherwise create an
--      ambiguous overload), so EXECUTE is re-granted to anon/authenticated/
--      service_role -- the exact set the prior function held.
--   2. update_event_sources is repointed to a deterministic replace-all on
--      public.event_sources. Its prior body upserted with
--      `on conflict (event_id, url)`, but the S1a table has NO unique index on
--      (event_id, url), so that upsert would ERROR. The replace-all (delete
--      then insert with index-based sort_order) needs no unique constraint and
--      is atomic inside the one definer transaction.
--
-- This migration does NOT drop events.source_url or create_event's p_source_url
-- (task S5 removes those). It does not touch producers, read RPCs, event_links,
-- or the registry literals.

-- ############################################################
-- 1. create_event: add trailing p_sources jsonb (atomic source insert)
-- ############################################################

drop function if exists public.create_event(uuid, uuid, text, date, text, uuid, text, text, date, text, boolean, text, text, text, text, uuid);

create function public.create_event(
  p_space_id uuid,
  p_event_type_id uuid,
  p_title text,
  p_event_date date,
  p_anchor_type text,
  p_anchor_id uuid default null::uuid,
  p_projection text default 'actual'::text,
  p_date_precision text default 'exact'::text,
  p_end_date date default null::date,
  p_end_date_precision text default 'exact'::text,
  p_is_ongoing boolean default false,
  p_description text default null::text,
  p_source_url text default null::text,
  p_significance text default null::text,
  p_visibility text default null::text,
  p_source_doc_id uuid default null::uuid,
  p_sources jsonb default null::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_ok boolean;
begin
  if not public.has_space_access(p_space_id, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;
  if p_anchor_type not in ('space','company','asset','trial') then
    raise exception 'invalid anchor_type' using errcode = '22023';
  end if;
  if p_anchor_type <> 'space' and p_anchor_id is null then
    raise exception 'anchor_id required for anchor_type %', p_anchor_type using errcode = '22023';
  end if;
  -- anchor entity must live in the space
  if p_anchor_type = 'company' then
    select exists(select 1 from public.companies where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'asset' then
    select exists(select 1 from public.assets where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'trial' then
    select exists(select 1 from public.trials where id = p_anchor_id and space_id = p_space_id) into v_ok;
  else v_ok := true; end if;
  if not v_ok then raise exception 'anchor % not in space %', p_anchor_id, p_space_id using errcode = '42501'; end if;

  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
    projection, date_precision, end_date, end_date_precision, is_ongoing, description, source_url,
    significance, visibility, source_doc_id)
  values (p_space_id, p_event_type_id, p_title, p_event_date, p_anchor_type, p_anchor_id,
    p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing, p_description, p_source_url,
    p_significance, p_visibility, p_source_doc_id)
  returning id into v_id;

  -- Atomic inline source insert (same definer tx). Skip empty/blank urls;
  -- sort_order = array ordinal so the stored order is deterministic.
  if p_sources is not null then
    insert into public.event_sources (event_id, url, label, sort_order)
    select v_id, (s.elem->>'url'), (s.elem->>'label'), (s.ord)::int
    from jsonb_array_elements(p_sources) with ordinality as s(elem, ord)
    where coalesce(s.elem->>'url','') <> '';
  end if;

  return v_id;
end; $function$;

-- Re-grant EXECUTE to exactly the roles the prior create_event held. A
-- DROP+CREATE produces a new function OID, so the old grants are gone.
grant execute on function public.create_event(uuid, uuid, text, date, text, uuid, text, text, date, text, boolean, text, text, text, text, uuid, jsonb) to anon;
grant execute on function public.create_event(uuid, uuid, text, date, text, uuid, text, text, date, text, boolean, text, text, text, text, uuid, jsonb) to authenticated;
grant execute on function public.create_event(uuid, uuid, text, date, text, uuid, text, text, date, text, boolean, text, text, text, text, uuid, jsonb) to service_role;

-- ############################################################
-- 2. update_event_sources: deterministic replace-all on event_sources
-- ############################################################
-- Same signature, guards (P0002 not-found, 42501 access, 22023 length-match)
-- byte-identical; only the persistence block changes from the broken upsert to
-- a delete-then-insert with index-based sort_order.

create or replace function public.update_event_sources(p_event_id uuid, p_urls text[], p_labels text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_space_id uuid;
  v_n_urls   int;
  v_n_labels int;
begin
  select space_id into v_space_id
    from public.events
   where id = p_event_id;

  if v_space_id is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_n_urls   := coalesce(array_length(p_urls,   1), 0);
  v_n_labels := coalesce(array_length(p_labels, 1), 0);
  if v_n_urls <> v_n_labels then
    raise exception 'urls and labels must be the same length (got % and %)',
      v_n_urls, v_n_labels using errcode = '22023';
  end if;

  -- Deterministic replace-all. Inside the one definer transaction the delete +
  -- insert is atomic, so there is no orphaned-then-empty window. sort_order =
  -- the array index, giving a stable, caller-controlled order without needing a
  -- unique constraint on (event_id, url).
  delete from public.event_sources where event_id = p_event_id;
  insert into public.event_sources (event_id, url, label, sort_order)
  select p_event_id, p_urls[i], p_labels[i], i
  from generate_subscripts(p_urls, 1) as i;
end;
$function$;

-- ############################################################
-- 3. In-file smoke (data-conditional, self-cleaning, prod-safe)
-- ############################################################

do $$
declare
  v_space_id uuid := '00000000-0000-0000-0000-0000000d0100';
  v_owner_id uuid;
  v_event_id uuid;
  v_rows     int;
  v_first    text;
begin
  if not exists (select 1 from public.spaces where id = v_space_id) then
    raise notice 'S1b smoke skipped: demo space % absent', v_space_id;
    return;
  end if;

  -- Resolve an owner of the demo space so has_space_access passes.
  select user_id into v_owner_id
    from public.space_members
   where space_id = v_space_id and role = 'owner'
   limit 1;

  if v_owner_id is null then
    raise notice 'S1b smoke skipped: demo space % has no owner member', v_space_id;
    return;
  end if;

  -- Act as that owner for this transaction so the definer gate resolves to them.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner_id, 'role', 'authenticated')::text,
    true
  );

  -- create_event with two inline sources (space-anchored, any seeded event type).
  v_event_id := public.create_event(
    p_space_id      => v_space_id,
    p_event_type_id => (select id from public.event_types order by id limit 1),
    p_title         => 'S1b smoke event',
    p_event_date    => current_date,
    p_anchor_type   => 'space',
    p_sources       => '[{"url":"https://a.test","label":"A"},{"url":"https://b.test","label":"B"}]'::jsonb
  );

  select count(*) into v_rows from public.event_sources where event_id = v_event_id;
  if v_rows <> 2 then
    raise exception 'SMOKE FAIL: expected 2 sources after create_event, got %', v_rows;
  end if;
  select url into v_first from public.event_sources where event_id = v_event_id order by sort_order limit 1;
  if v_first <> 'https://a.test' then
    raise exception 'SMOKE FAIL: first source url wrong, got %', v_first;
  end if;

  -- update_event_sources replaces them with a single row.
  perform public.update_event_sources(v_event_id, array['https://c.test'], array['C']);
  select count(*) into v_rows from public.event_sources where event_id = v_event_id;
  if v_rows <> 1 then
    raise exception 'SMOKE FAIL: expected 1 source after update_event_sources, got %', v_rows;
  end if;
  select url into v_first from public.event_sources where event_id = v_event_id;
  if v_first <> 'https://c.test' then
    raise exception 'SMOKE FAIL: replaced source url wrong, got %', v_first;
  end if;

  -- Cleanup: deleting the event cascades its sources.
  delete from public.events where id = v_event_id;
  perform set_config('request.jwt.claims', null, true);

  raise notice 'SMOKE PASS: create_event(p_sources) + update_event_sources round-trip OK';
end;
$$;

notify pgrst, 'reload schema';
